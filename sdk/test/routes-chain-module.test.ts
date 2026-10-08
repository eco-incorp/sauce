/**
 * A chain's module (`src/routes/chain-module.ts`) is written for every compile, so what does not
 * change between compiles is kept, and nothing is written that no program can reach. Kept or written
 * again, the text is the same; only the salt, in `HERE`, is the compile's.
 */
import { requireChain } from "../src/chains/canonical.js";
import { chainModuleSource, forgetChainModules } from "../src/routes/chain-module.js";

const SALT_A = `0x${"5a".repeat(32)}`;
const SALT_B = `0x${"a5".repeat(32)}`;

/** The hop line of `destination`'s class in a module: the facts a hop there is built with. */
const hopTo = (module: string, destination: string): string =>
  new RegExp(`class On${destination} \\{[\\s\\S]*?\\n  hop\\(config\\) \\{([^\\n]*)`).exec(
    module,
  )![1]!;

describe("a chain's module", () => {
  it.each(["base", "ethereum", "solana"])(
    "on %s is the same text written afresh or kept, and between compiles differs only in its salt",
    (slug) => {
      const chain = requireChain(slug);
      forgetChainModules();
      const fresh = chainModuleSource(chain, {}, SALT_A);
      const kept = chainModuleSource(chain, {}, SALT_A);
      expect(kept).toBe(fresh);
      expect(chainModuleSource(chain, {}, SALT_B).replaceAll(SALT_B, SALT_A)).toBe(fresh);
    },
  );

  it("keeps a destination's facts per intent defaults, and reads a fee given as a function each time", () => {
    const base = requireChain("base");
    const fee = (amount: bigint) => ({ intents: { executionFee: amount } });
    expect(hopTo(chainModuleSource(base, fee(7n), SALT_A), "Ethereum")).toContain("fee: 7,");
    expect(hopTo(chainModuleSource(base, fee(9n), SALT_A), "Ethereum")).toContain("fee: 9,");
    let read = 11n;
    const asked = { intents: { executionFee: () => read } };
    expect(hopTo(chainModuleSource(base, asked, SALT_A), "Ethereum")).toContain("fee: 11,");
    read = 12n;
    expect(hopTo(chainModuleSource(base, asked, SALT_A), "Ethereum")).toContain("fee: 12,");
  });

  it("gives a destination's tokens for the symbols the source chain has, which a `receive` names", () => {
    // SPCXc is Base's (Coinbase's tokenized SpaceX); TSLAx is a Backed xStock on Ethereum.
    const fromBase = hopTo(chainModuleSource(requireChain("base"), {}, SALT_A), "Ethereum");
    expect(fromBase).toMatch(/\bUSDC: 0x/);
    expect(fromBase).not.toMatch(/\bTSLAx: /);
    const fromEthereum = hopTo(chainModuleSource(requireChain("ethereum"), {}, SALT_A), "Base");
    expect(fromEthereum).toMatch(/\bUSDC: 0x/);
    expect(fromEthereum).not.toMatch(/\bSPCXc: /);
  });

  it("says what a namespace is once, in its class, not in each chain's instance", () => {
    const module = chainModuleSource(requireChain("base"), {}, SALT_A);
    expect(module.split("'UniswapV3' names no single contract").length - 1).toBe(1);
    // A protocol whose contract is missing on a chain says so for that chain, in its instance.
    expect(module).toContain(
      "Contract 'DegenBox' (abracadabra) is not deployed on 'optimism' (available: ethereum, arbitrum)",
    );
  });
});
