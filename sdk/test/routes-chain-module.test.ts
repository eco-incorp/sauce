/**
 * A compile's names module (`src/routes/chain-module.ts`): one text for every chain of a target,
 * written once and kept, and a text of its own for a compile that chose values of its own.
 */
import { requireChain } from "../src/chains/canonical.js";
import { chainModuleSource, forgetChainModules } from "../src/routes/chain-module.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

describe("the names module", () => {
  it("is one text for every chain of a target, written afresh or kept", () => {
    forgetChainModules();
    const base = chainModuleSource(requireChain("base"), {});
    expect(chainModuleSource(requireChain("ethereum"), {})).toBe(base);
    expect(chainModuleSource(requireChain("arbitrum"), {})).toBe(base);
    forgetChainModules();
    expect(chainModuleSource(requireChain("base"), {})).toBe(base);
    const solana = chainModuleSource(requireChain("solana"), {});
    expect(solana).not.toBe(base);
  });

  it("declares the same names on both targets", () => {
    const exported = (text: string) =>
      [...text.matchAll(/^export const (\w+) =/gm)].map(([, name]) => name).sort();
    const evm = exported(chainModuleSource(requireChain("base"), {}));
    const svm = exported(chainModuleSource(requireChain("solana"), {}));
    // `Token(address)` is the EVM's alone.
    expect(evm.filter((name) => name !== "Token")).toEqual(svm);
  });

  it("chooses a compile's own values for its chain alone", () => {
    const tokens = { USDT: "0x2222222222222222222222222222222222222222" } as const;
    const own = chainModuleSource(requireChain("base"), { tokens });
    expect(own).not.toBe(chainModuleSource(requireChain("base"), {}));
    expect(own).toMatch(/== 8453 \? new TokenOf\("USDT", 0x2222/);
  });

  it("says what a namespace is once, in its class", () => {
    const module = chainModuleSource(requireChain("base"), {});
    expect(module.split("'UniswapV3' has Factory,").length - 1).toBe(1);
    expect(() =>
      compileSauceProgram("base", "function main(): Uint256 { return Optimism.Abracadabra + 1; }"),
    ).toThrow("'Abracadabra' is abracadabra.DegenBox, which this chain has no deployment of");
  });
});
