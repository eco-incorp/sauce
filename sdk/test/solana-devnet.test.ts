/**
 * Solana devnet as a chain of its own, `solana-devnet` (1399811150, the CHAIN_ID the devnet engine
 * reports): a program compiled for it reads its own chain id, resolves symbols to devnet's mints,
 * and swaps at the venues deployed on devnet, each at its devnet program; a venue devnet lacks is
 * refused by name. The release is deployed on devnet; the live release check
 * (`requireSolanaRelease`) stays the gate of what is sent there.
 */
import { getAddressEncoder } from "@solana/kit";

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

  it("lists the venues deployed on devnet, each at its devnet program", () => {
    const venues = sourceGlobals(devnet).venues ?? [];
    expect(venues.map((venue) => [venue.namespace, venue.program])).toEqual([
      ["Raydium.CLMM", "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"],
      ["Stabble.CLMM", "6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6"],
      ["Orca.Whirlpool", "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"],
      ["Defituna.Fusion", "fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9"],
      ["Crema.CLMM", "CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR"],
      ["Phoenix.Market", "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY"],
      ["Meteora.DLMM", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"],
    ]);
    expect(sourceGlobals("solana").venues).toHaveLength(10);
  });

  it("compiles a swap for devnet against devnet's program: Raydium CLMM's guard names DRayAUg…", () => {
    const key = (base58: string) =>
      Buffer.from(getAddressEncoder().encode(base58 as never)).toString("hex");
    const source =
      "function main(pool: Address) { return Raydium.CLMM.swap(pool, USDC, WSOL, 1, 10, 0); }";
    const onDevnet = Buffer.from(compileSauceProgram("solana-devnet", source).bytecode).toString(
      "hex",
    );
    const onMainnet = Buffer.from(compileSauceProgram("solana", source).bytecode).toString("hex");
    expect(onDevnet).toContain(key("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"));
    expect(onDevnet).not.toContain(key("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"));
    expect(onMainnet).toContain(key("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"));
    expect(onMainnet).not.toContain(key("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"));
  });

  it.each([
    ["Byreal.CLMM", "Byreal"],
    ["Cropper.Whirlpool", "Cropper"],
  ])("refuses %s, which devnet lacks, naming the venue and the cluster", (namespace, name) => {
    const source = `function main(pool: Address) { return ${namespace}.swap(pool, USDC, WSOL, 1, 0, 0); }`;
    expect(() => compileSauceProgram("solana-devnet", source)).toThrow(
      `\`${namespace}\` is not on solana-devnet: ${name} has no program on Solana's devnet.`,
    );
    expect(() => compileSauceProgram("solana", source)).not.toThrow();
  });

  it("refuses Pancakeswap.CLMM, whose devnet program is there, with the reason it is withheld", () => {
    const source =
      "function main(pool: Address) { return Pancakeswap.CLMM.swap(pool, USDC, WSOL, 1, 0, 0); }";
    expect(() => compileSauceProgram("solana-devnet", source)).toThrow(
      "`Pancakeswap.CLMM` is not supported on solana-devnet: its devnet pools lack the tick arrays " +
        "a swap at a price needs.",
    );
    expect(() => compileSauceProgram("solana", source)).not.toThrow();
  });

  // The refusal is for a venue a program would call: not in code a test rules out, which any chain
  // may take, nor a name the program or its caller binds itself.
  it("refuses only a live, unbound venue name", () => {
    const seven = compileSauceProgram("solana-devnet", "function main() { return 7; }").bytecode;
    const programs = [
      "function main() { if (false) { Byreal.CLMM.swap(0, USDC, WSOL, 1, 0, 0); } return 7; }",
      "function main() { const Byreal = { CLMM: 7 }; return Byreal.CLMM; }",
    ];
    for (const source of programs) {
      expect([source, compileSauceProgram("solana-devnet", source).bytecode]).toEqual([
        source,
        seven,
      ]);
      // The same programs compile on mainnet, the control.
      expect(() => compileSauceProgram("solana", source)).not.toThrow();
    }
    // A name the caller defines is the caller's, not the venue: a live use of it is not refused as
    // one (the compiler, not this check, has the last word on what `Byreal.CLMM` is then).
    expect(() =>
      compileSauceProgram("solana-devnet", "function main() { return Byreal.CLMM; }", {
        defines: { Byreal: 7n },
      }),
    ).not.toThrow(/is not on solana-devnet/);
    // And a live, unbound venue call is still refused.
    expect(() =>
      compileSauceProgram(
        "solana-devnet",
        "function main() { return Byreal.CLMM.swap(0, USDC, WSOL, 1, 0, 0); }",
      ),
    ).toThrow(/`Byreal\.CLMM` is not on solana-devnet/);
  });

  it("supports devnet transactions where the release is deployed", () => {
    expect(chainSupport(devnet)).toBe("supported");
    expect(chainSupport("solana")).toBe("supported");
  });
});
