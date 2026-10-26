/**
 * Solana devnet as a chain of its own, `solana-devnet` (1399811150, the CHAIN_ID the devnet engine
 * reports): a program compiled for it reads its own chain id, resolves symbols to devnet's mints,
 * and has no Solana venue, whose pools are mainnet's. It is a preview chain until the release is
 * on devnet; the live release check (`requireSolanaRelease`) stays the gate of what is sent there.
 */
import { requireChain, svmChains } from "../src/chains/canonical.js";
import { isTestnet, nativeCoinSymbol } from "../src/chains/index.js";
import { chainSupport } from "../src/cli/support.js";
import { chainDefines } from "../src/routes/ambient.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { sourceGlobals } from "../src/routes/source-globals.js";
import { SVM_TOKEN_REGISTRY, svmClusterOf, svmTokenRows } from "../src/routes/token-registry.js";
import { ENGINE_CHAIN_IDS } from "../src/svm/engine.js";

const devnet = requireChain("solana-devnet");

describe("solana-devnet", () => {
  it("is the second Solana chain, by the devnet engine's CHAIN_ID", () => {
    expect(devnet).toMatchObject({ id: 1399811150, kind: "svm", name: "Solana Devnet" });
    expect(BigInt(devnet.id)).toBe(ENGINE_CHAIN_IDS.devnet);
    expect(requireChain("devnet").slug).toBe("solana-devnet");
    expect(svmChains().map((chain) => chain.slug)).toEqual(["solana", "solana-devnet"]);
    expect(svmClusterOf(devnet)).toBe("devnet");
    expect(svmClusterOf(requireChain("solana"))).toBe("mainnet-beta");
    expect(nativeCoinSymbol(devnet)).toBe("SOL");
    expect(isTestnet(devnet)).toBe(true);
    expect(isTestnet(requireChain("solana"))).toBe(false);
  });

  it("compiles chainId as 1399811150, what ctx.chainId() reads on the devnet engine", () => {
    expect(chainDefines(devnet).chainId).toBe(1399811150n);
    const source = "function main() { return chainId; }";
    const onDevnet = compileSauceProgram("solana-devnet", source).bytecode;
    expect(onDevnet).not.toEqual(compileSauceProgram("solana", source).bytecode);
    expect(onDevnet).toEqual(
      compileSauceProgram("solana", source, { defines: { chainId: 1399811150n } }).bytecode,
    );
  });

  it("resolves a symbol to devnet's mint, and has no stocks", () => {
    expect(svmTokenRows(devnet)).toBe(SVM_TOKEN_REGISTRY.devnet);
    const usdc = SVM_TOKEN_REGISTRY.devnet.find((row) => row.symbol === "USDC")!;
    const source = "function main() { return USDC; }";
    expect(compileSauceProgram("solana-devnet", source).bytecode).toEqual(
      compileSauceProgram("solana", source, {
        defines: { USDC: BigInt(usdc.address), chainId: 1399811150n },
      }).bytecode,
    );
    expect(sourceGlobals(devnet).tokens.map((token) => token.symbol)).toEqual(["USDC", "WSOL"]);
    expect(() => compileSauceProgram("solana-devnet", "function main() { return TSLAx; }")).toThrow(
      /TSLAx/,
    );
  });

  it("has no Solana venue: their pools are mainnet's", () => {
    expect(sourceGlobals(devnet).venues ?? []).toEqual([]);
    expect(sourceGlobals("solana").venues?.length).toBeGreaterThan(0);
    expect(() =>
      compileSauceProgram(
        "solana-devnet",
        "function main(pool: Address) { return Orca.Whirlpool.swap(pool, USDC, WSOL, 1, 0, 0); }",
      ),
    ).toThrow(/`Orca\.Whirlpool` is not on solana-devnet/);
  });

  it("is a preview chain until the release is on devnet", () => {
    expect(chainSupport(devnet)).toBe("preview");
    expect(chainSupport("solana")).toBe("supported");
  });
});
