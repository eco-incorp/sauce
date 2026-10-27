/**
 * Solana testnet as a chain of its own, `solana-testnet`. Its registry key, 1399811151, names it to
 * the SDK; testnet runs the devnet engine build, so a program compiled for it reads `chainId` as
 * 1399811150, what `ctx.chainId()` returns there, exactly as on devnet. Its symbols are testnet's
 * mints, and it has no Solana venue, whose pools are mainnet's.
 */
import { requireChain } from "../src/chains/canonical.js";
import { isTestnet, nativeCoinSymbol } from "../src/chains/index.js";
import { chainSupport } from "../src/cli/support.js";
import { chainDefines, programChainId } from "../src/routes/ambient.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { sourceGlobals } from "../src/routes/source-globals.js";
import { SVM_TOKEN_REGISTRY, svmClusterOf, svmTokenRows } from "../src/routes/token-registry.js";
import { SOLANA_CLUSTERS } from "../src/svm/clusters.js";
import { ENGINE_CHAIN_IDS } from "../src/svm/engine.js";

const testnet = requireChain("solana-testnet");

describe("solana-testnet", () => {
  it("is the third Solana chain, under a registry key of its own", () => {
    expect(testnet).toMatchObject({ id: 1399811151, kind: "svm", name: "Solana Testnet" });
    expect(requireChain("testnet").slug).toBe("solana-testnet");
    expect(svmClusterOf(testnet)).toBe("testnet");
    expect(nativeCoinSymbol(testnet)).toBe("SOL");
    expect(isTestnet(testnet)).toBe(true);
    // Testnet runs the devnet build: its engine reports devnet's CHAIN_ID.
    expect(SOLANA_CLUSTERS.testnet.engineChainId).toBe(ENGINE_CHAIN_IDS.devnet);
  });

  it("compiles chainId as 1399811150, what ctx.chainId() reads on testnet's engine", () => {
    expect(programChainId(testnet)).toBe(1399811150n);
    expect(chainDefines(testnet)).toMatchObject({ chainId: 1399811150n, CHAIN_ID: 1399811150n });
    const source = "function main() { return chainId; }";
    const onTestnet = compileSauceProgram("solana-testnet", source).bytecode;
    expect(onTestnet).toEqual(compileSauceProgram("solana-devnet", source).bytecode);
    expect(onTestnet).not.toEqual(compileSauceProgram("solana", source).bytecode);
    expect(onTestnet).not.toEqual(
      compileSauceProgram("solana", source, { defines: { chainId: 1399811151n } }).bytecode,
    );
  });

  it("leaves every other chain's chainId its own id", () => {
    expect(programChainId(requireChain("solana"))).toBe(ENGINE_CHAIN_IDS.mainnet);
    expect(programChainId(requireChain("solana-devnet"))).toBe(ENGINE_CHAIN_IDS.devnet);
    for (const slug of ["solana", "solana-devnet", "ethereum", "base", "arc-testnet"]) {
      const chain = requireChain(slug);
      expect([slug, chainDefines(chain).chainId]).toEqual([slug, BigInt(chain.id)]);
    }
  });

  it("resolves a symbol to testnet's mint: the wrapped native alone, no USDC and no stocks", () => {
    expect(svmTokenRows(testnet)).toBe(SVM_TOKEN_REGISTRY.testnet);
    expect(sourceGlobals(testnet).tokens.map((token) => token.symbol)).toEqual(["WSOL"]);
    const wsol = SVM_TOKEN_REGISTRY.testnet.find((row) => row.symbol === "WSOL")!;
    const source = "function main() { return WSOL; }";
    expect(compileSauceProgram("solana-testnet", source).bytecode).toEqual(
      compileSauceProgram("solana", source, {
        defines: { WSOL: BigInt(wsol.address), chainId: 1399811150n },
      }).bytecode,
    );
    for (const symbol of ["USDC", "TSLAx"]) {
      expect(() =>
        compileSauceProgram("solana-testnet", `function main() { return ${symbol}; }`),
      ).toThrow(new RegExp(symbol));
    }
  });

  it("has no Solana venue: their pools are mainnet's", () => {
    expect(sourceGlobals(testnet).venues ?? []).toEqual([]);
    expect(() =>
      compileSauceProgram(
        "solana-testnet",
        "function main(pool: Address) { return Orca.Whirlpool.swap(pool, WSOL, WSOL, 1, 0, 0); }",
      ),
    ).toThrow(/`Orca\.Whirlpool` is not on solana-testnet/);
  });

  it("supports testnet transactions where the release is deployed", () => {
    expect(chainSupport(testnet)).toBe("supported");
  });
});
