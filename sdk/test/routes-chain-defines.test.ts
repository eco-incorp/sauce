/**
 * A caller's define named like a chain-scoped name — a token symbol, `chainId` — is that chain's
 * value, declared by its host for it alone (`sauce-route.ts#splitChainDefines`), not a define. A
 * define binds before the compiler asks the host, so left one it would be read wherever the
 * program names it — in an intent's delivery too, which the compiler evaluates in the enclosing
 * program's frame with the destination's names. Each case reads the delivery as `bind` receives it
 * (`src/routes/intent-host.ts`).
 */
import type { View } from "sauce-compiler";

const { jest } = import.meta as unknown as {
  jest: { unstable_mockModule(path: string, factory: () => unknown): void };
};
const realIntents = await import("../src/routes/intent-host.js");
/** The delivery of each intent bound since the last `deliveries`, in bind order. */
let bound: View[] = [];
jest.unstable_mockModule("../src/routes/intent-host.js", () => ({
  ...realIntents,
  intentHost: (level: Parameters<typeof realIntents.intentHost>[0]) => {
    const host = realIntents.intentHost(level);
    return {
      ...host,
      bind: (site: Parameters<typeof host.bind>[0]) => {
        const receiver = site.receiver;
        const delivery =
          receiver !== undefined && "record" in receiver
            ? receiver.record.parts.find((part) => part.callee === "Sent.receive")?.args[0]
            : undefined;
        if (delivery !== undefined) bound.push(delivery);
        return host.bind(site);
      },
    };
  },
}));
const { compileSauceProgram } = await import("../src/routes/sauce-route.js");
const { chainDefines } = await import("../src/routes/ambient.js");
const { requireChain } = await import("../src/chains/canonical.js");
const { registryTokenAddress } = await import("../src/routes/token-registry.js");

const INTENTS = {
  deadline: 4_000_000_000n,
  executionFee: 0n,
} as const;

/** The token and amount of the one delivery entry the Base program's Arbitrum intent binds. */
function delivery(defines: Record<string, bigint | boolean | number>): [string, string] {
  bound = [];
  compileSauceProgram(
    "base",
    `function main() {
  const amount = USDC.balanceOf(self);
  Arbitrum.Portal.send([{ token: USDC, amount }]).refundee(0x3333333333333333333333333333333333333333).receive([{ token: USDC, amount: chainId }]).then(() => {
    USDC.transfer(self, amount);
  });
}`,
    { defines, intents: INTENTS },
  );
  expect(bound).toHaveLength(1);
  const fields = (view: View) =>
    "fields" in view ? new Map(view.fields) : fail("a record of fields");
  const entries = bound[0]!;
  const [entry] = "elements" in entries ? entries.elements : fail("a list of tokens");
  const constant = (view: View | undefined) =>
    view !== undefined && "constant" in view ? view.constant : fail("a constant");
  const tokenEntry = fields(entry!);

  return [constant(tokenEntry.get("token")), constant(tokenEntry.get("amount"))];
}

const fail = (what: string): never => {
  throw new Error(`expected ${what}`);
};

describe("a caller's chain-scoped defines are its chain's, and nowhere else's", () => {
  const arbitrum = requireChain("arbitrum");
  const ARBITRUM = [
    registryTokenAddress(arbitrum, "USDC")!.toString(),
    BigInt(arbitrum.id).toString(),
  ];

  it("a delivery names the destination's USDC and chainId", () => {
    expect(delivery({})).toEqual(ARBITRUM);
  });

  it("so does one compiled with every Base value as a define", () => {
    // `USDC` and `chainId` are Base's in these defines: as defines they would bind first, in the
    // frame the delivery is evaluated in.
    expect(delivery({ ...chainDefines(requireChain("base")) })).toEqual(ARBITRUM);
  });
});
