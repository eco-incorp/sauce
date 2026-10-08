/**
 * A caller's define named like a chain-scoped name — a token symbol, `chainId` — is that chain's
 * value, written into its module of names for it alone (`sauce-route.ts#splitChainDefines`), not a
 * define. A define replaces a module's `const` of that name in every module, so left one it would
 * replace the chain's `USDC` token with a plain number, and reach every body on another chain.
 *
 * An intent's delivery names the DESTINATION's token of each symbol (`@sauce/hop`), whatever
 * the caller defined for the chain the program runs on; every other name in it is the program's
 * own, evaluated where the intent opens. Each case reads the delivery the Portal logs on a Base
 * anvil (`intent-anvil.ts`).
 */
import { requireChain } from "../src/chains/canonical.js";
import { chainDefines } from "../src/routes/ambient.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { describeEvm } from "./cli-anvil.js";
import { startIntentChain, type IntentChain } from "./intent-anvil.js";
import { freePort } from "./pools-anvil.js";

const INTENTS = {
  deadline: 4_000_000_000n,
  executionFee: 0n,
} as const;

describeEvm("a caller's chain-scoped defines are its chain's, and nowhere else's", () => {
  let base: IntentChain;
  beforeAll(async () => {
    base = await startIntentChain("base", await freePort(), ["USDC"]);
  }, 120_000);
  afterAll(async () => {
    await base?.stop();
  });

  /** The token and amount of the one delivery entry the Base program's Arbitrum intent logs. */
  const delivery = async (
    defines: Record<string, bigint | boolean | number>,
  ): Promise<[bigint, bigint]> => {
    const program = compileSauceProgram(
      "base",
      `function main() {
  Arbitrum.hop({ send: [{ token: USDC, amount: 5 }], receive: [{ token: USDC, amount: chainId }], refundee: 0x3333333333333333333333333333333333333333 }).then(() => {
    USDC.transfer(ctx.self(), chainId);
  });
}`,
      { defines, intents: INTENTS },
    );
    const [published] = await base.publish(program);
    const [entry] = published!.intent.route.tokens;

    return [BigInt(entry!.token), entry!.amount];
  };

  const ARBITRUM_USDC = registryTokenAddress(requireChain("arbitrum"), "USDC")!;

  it("a delivery names the destination's USDC; `chainId` in it is the program's", async () => {
    expect(await delivery({})).toEqual([ARBITRUM_USDC, 8453n]);
  }, 120_000);

  it("so does one compiled with every Base value as a define", async () => {
    // `USDC` and `chainId` are Base's in these defines: as defines they would replace the module's
    // `USDC` token with a number, and reach the body's program on Arbitrum.
    expect(await delivery({ ...chainDefines(requireChain("base")) })).toEqual([
      ARBITRUM_USDC,
      8453n,
    ]);
  }, 120_000);
});
