/**
 * The extensions manifest (`src/routes/extensions.ts`): it loads for every chain, names each chain
 * by the key a program spells it with, and refuses what a chain lacks with where it is instead.
 */
import { CANONICAL_CHAINS, requireChain } from "../src/chains/canonical.js";
import { chainKey, EXTENSIONS_PATH, serveExtensions } from "../src/routes/extensions.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

/** `{ ok }` for a program that compiles on `chain`; `{ ok: false, message }` for one refused. */
function refused(
  chain: string,
  source: string,
): { readonly ok: boolean; readonly message?: string } {
  try {
    compileSauceProgram(chain, source);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

describe("what a chain lacks", () => {
  it("a token another chain registers is refused by name, with where it is", () => {
    const result = refused(
      "base",
      "function main(): void { USDT.transfer(0x1111111111111111111111111111111111111111, 5n); }",
    );
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain(
      "`USDT` is not a token base registers; it is registered on:",
    );
  });

  it("a contract another chain deploys is refused with the chains that have it", () => {
    const result = refused(
      "optimism",
      "function main(): Uint256 { return PancakeswapV3.Factory; }",
    );
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain(
      "Contract 'Factory' (pancakeswap-v3) is not deployed on 'optimism'",
    );
  });

  it("the token syntax is refused on the SVM, naming the functions to use instead", () => {
    const result = refused(
      "solana",
      "function main(): void { USDC.transfer(0x1111111111111111111111111111111111111111, 5n); }",
    );
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("the ERC20 token syntax is EVM-only");
  });
});

describe("the manifest", () => {
  it("loads for every canonical chain", () => {
    for (const chain of CANONICAL_CHAINS) {
      const result = refused(chain.slug, "function main(): Uint256 { return chainId; }");
      expect(result.ok).toBe(true);
    }
  });

  it("names every chain by the key a program spells it with", () => {
    const document = JSON.parse(
      new TextDecoder().decode(serveExtensions(requireChain("base"))(EXTENSIONS_PATH)!),
    ) as { current: string; chains: Record<string, { id: number }> };
    expect(document.current).toBe("Base");
    expect(Object.keys(document.chains).sort()).toEqual(CANONICAL_CHAINS.map(chainKey).sort());
  });
});
