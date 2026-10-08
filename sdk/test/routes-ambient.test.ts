/**
 * Chain-scoped scalar ambient defines (`ambient.ts#chainDefines`).
 */
import { requireChain } from "../src/chains/canonical.js";
import { chainDefines } from "../src/routes/index.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { getDescriptor, addressOn } from "../src/descriptors/query.js";

describe("chainDefines", () => {
  it("contains chainId === 8453n for base", () => {
    const defines = chainDefines(requireChain("base"));
    expect(defines.chainId).toBe(8453n);
    expect(defines.CHAIN_ID).toBe(8453n);
  });

  it("a UniswapV4_UniversalRouter entry equals BigInt of the descriptor's own address for 8453, read independently", () => {
    const descriptor = getDescriptor("uniswap-v4", "UniversalRouter");
    expect(descriptor).toBeDefined();
    const address = addressOn(descriptor!, requireChain("base"));
    expect(address).toBeDefined();

    const defines = chainDefines(requireChain("base"));
    expect(defines.UniswapV4_UniversalRouter).toBe(BigInt(address!));
  });

  it("a chain with no address for a contract omits that key entirely rather than emitting 0n", () => {
    // Ronin (2020) has a v12 deploy-record entry but no descriptor coverage for most protocols.
    const defines = chainDefines(requireChain("ronin"));
    expect(defines.UniswapV4_UniversalRouter).toBeUndefined();
    expect("UniswapV4_UniversalRouter" in defines).toBe(false);
  });

  it("negative control: a chain the token registry does not cover defines no token symbol unless the caller supplies one", () => {
    // Ronin has no token-registry rows (see token-registry.ts's coverage note).
    const defines = chainDefines(requireChain("ronin"));
    expect(defines.USDC).toBeUndefined();
  });

  it("base's registry USDC/WETH are DEFAULT ambient defines with no caller tokens at all", () => {
    const defines = chainDefines(requireChain("base"));
    expect(defines.USDC).toBe(BigInt("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"));
    expect(defines.WETH).toBe(BigInt("0x4200000000000000000000000000000000000006"));
  });

  it("a caller-supplied token symbol resolves to BigInt(address)", () => {
    const FOO = "0x5555555555555555555555555555555555555555" as const;
    const defines = chainDefines(requireChain("base"), { tokens: { FOO } });
    expect(defines.FOO).toBe(BigInt(FOO));
  });

  it("a caller-supplied token OVERRIDES the registry default for the same symbol, per-key", () => {
    const OTHER_USDC = "0x5555555555555555555555555555555555555555" as const;
    const defines = chainDefines(requireChain("base"), { tokens: { USDC: OTHER_USDC } });
    expect(defines.USDC).toBe(BigInt(OTHER_USDC));
    // WETH stays the registry default -- override is per-key, not wholesale.
    expect(defines.WETH).toBe(BigInt("0x4200000000000000000000000000000000000006"));
  });
});

describe("a program compile: the chain's names", () => {
  it("`chainId` compiles to the chain's id, the same program as a define of it", () => {
    const viaAmbient = compileSauceProgram("ethereum", "function main() { return chainId; }");
    const viaExplicit = compileSauceProgram("ethereum", "function main() { return chainId; }", {
      defines: { chainId: 1n },
    });
    expect(viaAmbient.bytecode).toEqual(viaExplicit.bytecode);
  });

  it("a caller define OVERRIDES a chain-scoped name of the same name", () => {
    const built = compileSauceProgram("ethereum", "function main() { return chainId; }", {
      defines: { chainId: 999n },
    });
    const explicit999 = compileSauceProgram("ethereum", "function main() { return 999n; }");
    expect(built.bytecode).toEqual(explicit999.bytecode);
  });

  it("a user `let chainId = 7n;` inside the body shadows the ambient define (proven by a differing program)", () => {
    const shadowed = compileSauceProgram(
      "ethereum",
      "function main() { let chainId = 7n; return chainId; }",
    );
    const unshadowed = compileSauceProgram("ethereum", "function main() { return chainId; }");
    expect(shadowed.bytecode).not.toEqual(unshadowed.bytecode);
    // the shadowed program compiles a local write+read, not the folded ambient literal --
    // distinct in shape from a program returning the ambient value directly.
    const ambientLiteral = compileSauceProgram("ethereum", "function main() { return 1n; }");
    expect(shadowed.bytecode).not.toEqual(ambientLiteral.bytecode);
  });

  it("an svm chain gets chainId and the caller token map, and compiles on target 'svm'", () => {
    const USDC = "0x5555555555555555555555555555555555555555" as const;
    const built = compileSauceProgram("solana", "function main() { return chainId; }", {
      tokens: { USDC },
    });
    expect(built.bytecode.length).toBeGreaterThan(0);

    const defines = chainDefines(requireChain("solana"), { tokens: { USDC } });
    expect(defines.chainId).toBe(BigInt(requireChain("solana").id));
    expect(defines.USDC).toBe(BigInt(USDC));
  });
});
