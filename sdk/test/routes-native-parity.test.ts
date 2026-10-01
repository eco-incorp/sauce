/**
 * The native pipeline against the rewrite pipeline, on one corpus.
 *
 * Natively, the compiler reads the extensions manifest (`src/routes/extensions.ts`) and resolves
 * token symbols, protocol namespaces, `Token(address)`, `self`, `chainId` and `available(…)` itself;
 * none of `token-rewrite.ts`, `protocol-rewrite.ts` or `available.ts` runs. This suite is what lets
 * those passes be deleted one at a time: every program in the corpus must compile to the same
 * bytecode both ways, or fail both ways.
 *
 * "The same bytecode" allows exactly one difference, and proves it is only that. The token rewrite
 * prepends `import … from "@sauce/token"` to a program, which loads that module before the
 * program's own imports; natively it is an ambient module, loaded after them. The functions are the
 * same, numbered in a different order. So a program whose bytes differ is compiled natively again
 * with the rewrite's import lines in front, which restores the old order — and must then match.
 * A program that opens an intent embeds a child compiled both ways, which that cannot reach; it is
 * held to the same intents and the same length.
 *
 * Needs a compiler with the extensions manifest (the v12 stack ending at program literals); with
 * the published 2.4.0 the suite is skipped.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "../src/wasm-compiler.js";
import { resolveSdkModule, resolveSdkPackage } from "../src/embedded/resolve.js";
import { CANONICAL_CHAINS, requireChain } from "../src/chains/canonical.js";
import { compileSauceProgram, useNativePipeline } from "../src/routes/sauce-route.js";
import {
  chainKey,
  EXTENSIONS_PATH,
  isTokenSymbol,
  serveExtensions,
} from "../src/routes/extensions.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GOLDEN = join(ROOT, "sdk/test/fixtures/native-golden.json");
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Whether the installed compiler reads an extensions manifest. */
const native = ((): boolean => {
  const serve = serveExtensions(requireChain("base"));
  try {
    compile({
      target: "evm",
      extensions: EXTENSIONS_PATH,
      resolve: (path: string) =>
        path === "main.js"
          ? new TextEncoder().encode("function main(): Uint256 { return chainId; }")
          : (serve(path) ?? resolveSdkModule(path)),
      resolvePackage: resolveSdkPackage,
    } as never);
    return true;
  } catch {
    return false;
  }
})();
const describeNative = native ? describe : describe.skip;

const INTENTS = {
  deadline: 1_900_000_000n,
  creator: "0x1111111111111111111111111111111111111111",
  executionFee: 1n,
} as const;

/** A value for a program's own free parameters (`RECIPIENT`, `MIN_OUT`), so the comparison reaches
 *  the rest of it. */
const FILLER = 0x3333333333333333333333333333333333333333n;

type Outcome =
  | {
      readonly ok: true;
      readonly bytecode: Uint8Array;
      readonly source: string;
      readonly intents: number;
    }
  | { readonly ok: false; readonly message: string };

function outcome(chain: string, source: string, nativePipeline: boolean, defines: object): Outcome {
  useNativePipeline(nativePipeline);
  try {
    const program = compileSauceProgram(chain, source, { intents: INTENTS, defines } as never);
    return {
      ok: true,
      bytecode: program.bytecode,
      source: program.source,
      intents: program.intents.length,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  } finally {
    useNativePipeline(false);
  }
}

/** The rewrite pipeline's outcome, with filler defines for every name the program leaves free. */
function rewritten(chain: string, source: string): { outcome: Outcome; defines: object } {
  const defines: Record<string, bigint> = {};
  let result = outcome(chain, source, false, defines);
  for (let i = 0; i < 8 && !result.ok; i++) {
    const free =
      /`([A-Z_][A-Z0-9_]*)` is not a declared variable/.exec(result.message)?.[1] ??
      /refers to '([A-Z_][A-Z0-9_]*)'/.exec(result.message)?.[1];
    // A token symbol a chain lacks is not a parameter the program left free: it is the refusal.
    if (free === undefined || free in defines || isTokenSymbol(free)) break;
    defines[free] = FILLER;
    result = outcome(chain, source, false, defines);
  }
  return { outcome: result, defines };
}

/** The import lines the rewrite put in front of `original`. */
function prependedImports(rewrittenSource: string, original: string): string {
  return rewrittenSource
    .split("\n")
    .filter((line) => line.startsWith("import ") && !original.includes(line))
    .join("\n");
}

/** The native outcomes this run saw, by case — written to the golden fixture on request. */
const golden: Record<string, { defines: string[]; sha256?: string; error?: true }> = {};

function expectParity(chain: string, source: string, name?: string): void {
  const { outcome: old, defines } = rewritten(chain, source);
  const fresh = outcome(chain, source, true, defines);
  if (name !== undefined) {
    golden[`${name}@${chain}`] = fresh.ok
      ? { defines: Object.keys(defines), sha256: sha256Hex(fresh.bytecode) }
      : { defines: Object.keys(defines), error: true };
  }
  if (!old.ok) {
    expect(fresh.ok).toBe(false);
    return;
  }
  if (!fresh.ok)
    throw new Error(`native compile failed where the rewrite succeeded: ${fresh.message}`);
  if (Buffer.from(old.bytecode).equals(Buffer.from(fresh.bytecode))) return;
  // An intent the program opens embeds its child program, compiled by the same two pipelines, so
  // its functions are numbered in the two orders too — inside calldata the reordering below cannot
  // reach. Its shape is what can be held equal: the same intents, the same length.
  if (old.intents > 0) {
    expect(fresh.intents).toBe(old.intents);
    expect(fresh.bytecode.length).toBe(old.bytecode.length);
    return;
  }

  const reordered = outcome(
    chain,
    `${prependedImports(old.source, source)}\n${source}`,
    true,
    defines,
  );
  expect(reordered.ok).toBe(true);
  expect(Buffer.from((reordered as { bytecode: Uint8Array }).bytecode).toString("hex")).toBe(
    Buffer.from(old.bytecode).toString("hex"),
  );
}

function sauceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sauceFiles(full);
    return name.endsWith(".sauce.ts") ? [full] : [];
  });
}

const CORPUS = [
  ...sauceFiles(join(ROOT, "docs/examples")),
  ...sauceFiles(join(ROOT, "skills")),
  ...sauceFiles(join(ROOT, "sdk/test/fixtures/sauce-script")),
  ...sauceFiles(join(ROOT, "sdk/src/recipes")),
].map((file) => ({
  name: file.slice(ROOT.length + 1),
  source: readFileSync(file, "utf8"),
  chains: /solana|svm/i.test(file) ? ["solana"] : ["base", "arbitrum", "ethereum"],
}));

/** Each shape the rewrites lowered, one program each. */
const SHAPES: readonly (readonly [string, string])[] = [
  [
    "a token write",
    "function main(): void { USDC.transfer(0x1111111111111111111111111111111111111111, 5n); }",
  ],
  [
    "a token approve",
    "function main(): void { USDC.approve(0x1111111111111111111111111111111111111111, 5n); }",
  ],
  [
    "a token transferFrom",
    "function main(a: Address): void { USDC.transferFrom(a, 0x1111111111111111111111111111111111111111, 5n); }",
  ],
  ["a token read", "function main(): Uint256 { return USDC.balanceOf(ctx.self()); }"],
  ["a bare self", "function main(): Uint256 { return USDC.balanceOf(self); }"],
  ["a holder's balance", "function main(pool: Address): Uint256 { return pool.WETH; }"],
  [
    "Token(address)",
    "function main(t: Address): void { Token(t).approve(0x1111111111111111111111111111111111111111, 5n); }",
  ],
  [
    "a bound Token",
    "function main(t: Address): Uint256 { const token = Token(t); token.transfer(t, 1n); return token.balanceOf(t); }",
  ],
  [
    "a protocol call",
    "function main(a: Address, b: Address): Address { return UniswapV3.Factory.getPool(a, b, 500n); }",
  ],
  ["a protocol address", "function main(): Uint256 { return Cctp.TokenMessenger; }"],
  ["a chain-qualified address", "function main(): Uint256 { return Arbitrum.UniswapV3.Factory; }"],
  ["a family alias", "function main(): Uint256 { return Uniswap.UniversalRouter; }"],
  [
    "an interface at an address",
    "function main(v: Address, a: Address): Uint256 { return Erc4626.Vault.at(v).balanceOf(a); }",
  ],
  ["an underscore spelling", "function main(): Uint256 { return UniswapV3_Factory; }"],
  [
    "a default the chain overrides",
    "const UniswapV3_Factory = 0n;\nfunction main(): Uint256 { return UniswapV3_Factory + chainId; }",
  ],
  ["chainId", "function main(): Uint256 { return chainId + CHAIN_ID; }"],
  [
    "available, decided true",
    "function main(): Uint256 { if (available(UniswapV3.Factory)) { return UniswapV3.Factory; } return 0n; }",
  ],
  ["available of a token", "function main(): Uint256 { return available(USDC) ? 1n : 0n; }"],
  [
    "a guard that leaves",
    "function main(): Uint256 { if (!available(PancakeswapV3.Factory)) { return 0n; } return PancakeswapV3.Factory; }",
  ],
  ["a script", "USDC.transfer(0x1111111111111111111111111111111111111111, 5n);"],
];

describeNative("native pipeline: the corpus compiles as the rewrites compiled it", () => {
  for (const { name, source, chains } of CORPUS) {
    for (const chain of chains) {
      it(`${name} on ${chain}`, () => expectParity(chain, source, name));
    }
  }
  // `UPDATE_NATIVE_GOLDEN=1` records what the native pipeline compiled every case to, proven equal
  // to the rewrites above, for `routes-native-golden.test.ts` to hold it to once they are gone.
  afterAll(() => {
    if (process.env.UPDATE_NATIVE_GOLDEN !== "1") return;
    const sorted = Object.fromEntries(
      Object.entries(golden).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(GOLDEN, `${JSON.stringify(sorted, null, 2)}\n`);
  });
});

describeNative("native pipeline: each shape the rewrites lowered", () => {
  for (const [what, source] of SHAPES) {
    for (const chain of ["base", "optimism", "arbitrum"]) {
      it(`${what} on ${chain}`, () => expectParity(chain, source));
    }
  }
});

describeNative("native pipeline: what a chain lacks", () => {
  it("a token another chain registers is refused by name, with where it is", () => {
    const result = outcome(
      "base",
      "function main(): void { USDT.transfer(0x1111111111111111111111111111111111111111, 5n); }",
      true,
      {},
    );
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain(
      "`USDT` is not a token base registers; it is registered on:",
    );
  });

  it("a contract another chain deploys is refused with the chains that have it", () => {
    const result = outcome(
      "optimism",
      "function main(): Uint256 { return PancakeswapV3.Factory; }",
      true,
      {},
    );
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain(
      "Contract 'Factory' (pancakeswap-v3) is not deployed on 'optimism'",
    );
  });

  it("the token syntax is refused on the SVM, naming the functions to use instead", () => {
    const result = outcome(
      "solana",
      "function main(): void { USDC.transfer(0x1111111111111111111111111111111111111111, 5n); }",
      true,
      {},
    );
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("the ERC20 token syntax is EVM-only");
  });
});

describeNative("the manifest", () => {
  it("loads for every canonical chain", () => {
    for (const chain of CANONICAL_CHAINS) {
      expect(() =>
        outcome(chain.slug, "function main(): Uint256 { return chainId; }", true, {}),
      ).not.toThrow();
      const result = outcome(chain.slug, "function main(): Uint256 { return chainId; }", true, {});
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
