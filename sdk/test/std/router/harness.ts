/**
 * `@sauce/router` (sdk/src/std/router) compiled through the published compiler OFF DISK, the way a
 * Node host's `node_modules` walk hands it the package: a bare `@sauce/router` mapped to the
 * package's neutral entry, its relative `./<pool>.abi.json` imports served from the same directory,
 * and the `@sauce/token` it imports mapped the same way. A miss returns `undefined`, the compiler's
 * "absent" signal its per-target arm probe relies on (see `../token/harness.ts`).
 *
 * The SDK serves the same files from memory (`src/embedded/resolve.ts`); compiling through both and
 * comparing bytes is what holds the embedded copy to the files.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompileOptions, CompileResult, SauceTarget } from "sauce-compiler";

// Required, not imported, for the reason `../token/harness.ts` gives: the `node` build is CommonJS
// and reads its sibling `.wasm` off disk at load.
const { compile } = createRequire(import.meta.url)("sauce-compiler") as {
  compile: (options: CompileOptions) => CompileResult;
};

const STD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "std");
const PACKAGES: Readonly<Record<string, string>> = {
  "@sauce/router": "router",
  "@sauce/token": "token",
};
const ENTRY = "main.js";

/** The directory of `src/std` that serves `path`, when it lands in one of the two packages. */
function fileFor(path: string): string | undefined {
  const key = path.startsWith("./") ? path.slice(2) : path;
  for (const [specifier, dir] of Object.entries(PACKAGES)) {
    const root = `node_modules/${specifier}/`;
    if (key.startsWith(root)) return join(STD, dir, key.slice(root.length));
  }

  return undefined;
}

const resolveModule =
  (entry: string) =>
  (path: string): Uint8Array | undefined => {
    const key = path.startsWith("./") ? path.slice(2) : path;
    if (key === ENTRY) return Buffer.from(entry);
    const file = fileFor(key);

    return file !== undefined && existsSync(file) ? readFileSync(file) : undefined;
  };

/** Each package's `main`, the neutral base the compiler suffixes per target. */
const resolvePackage = (specifier: string): string | undefined => {
  const dir = PACKAGES[specifier];
  if (dir === undefined) return undefined;
  const { main } = JSON.parse(readFileSync(join(STD, dir, "package.json"), "utf8")) as {
    main: string;
  };

  return `node_modules/${specifier}/${main}`;
};

/** Compile `entry`, which imports `@sauce/router`, against the library's files on disk. */
export const compileStdRouter = (entry: string, target: SauceTarget = "evm"): CompileResult =>
  compile({ target, entry: ENTRY, resolve: resolveModule(entry), resolvePackage });

/** The library's source, for reading what it exports. */
export const routerSource = (): string =>
  readFileSync(join(STD, "router", "router.evm.js"), "utf8");

/** A pool-ABI file of the library, parsed. */
export const routerAbi = (file: string): { $comment: string; abi: readonly unknown[] } =>
  JSON.parse(readFileSync(join(STD, "router", file), "utf8")) as {
    $comment: string;
    abi: readonly unknown[];
  };

const A = "0x1111111111111111111111111111111111111111n";
const B = "0x2222222222222222222222222222222222222222n";
const POOL = "0x3333333333333333333333333333333333333333n";
const POOL_ID = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019n";
const VAULT = "0x238a358808379702088667322f80aC48bAd5e6c4n";
/** An Infinity CL pool's `parameters`: tick spacing 10 in bits 16..39, no hook permissions. */
const PARAMETERS = "0xa0000n";

/** Every exported function, called with run-time arguments from `main`'s own parameters. */
export const FUNCTIONS: Readonly<Record<string, string>> = {
  uniswapV2: `uniswapV2(${POOL}, ${A}, ${B}, amount, 3000n, minOut, ctx.self())`,
  tryUniswapV2: `tryUniswapV2(${POOL}, ${A}, ${B}, amount, 2500n, minOut, ctx.self())`,
  curve: `curve(${POOL}, ${A}, ${B}, amount, 1n, 2n, false, minOut, ctx.self())`,
  tryCurve: `tryCurve(${POOL}, ${A}, ${B}, amount, 0n, 2n, true, minOut, ctx.self())`,
  balancerV2: `balancerV2(${POOL}, ${A}, ${B}, amount, ${POOL_ID}, minOut, ctx.self())`,
  tryBalancerV2: `tryBalancerV2(${POOL}, ${A}, ${B}, amount, ${POOL_ID}, minOut, ctx.self())`,
  dodoV2: `dodoV2(${POOL}, ${A}, ${B}, amount, ${A}, ${B}, minOut, ctx.self())`,
  traderJoeLB: `traderJoeLB(${POOL}, ${A}, ${B}, amount, ${A}, ${B}, minOut, ctx.self())`,
  tryTraderJoeLB: `tryTraderJoeLB(${POOL}, ${A}, ${B}, amount, ${B}, ${A}, minOut, ctx.self())`,
  woofi: `woofi(${POOL}, ${A}, ${B}, amount, minOut, ctx.self())`,
  uniswapV3: `uniswapV3(${POOL}, ${A}, ${B}, amount, 0n, minOut, ctx.self())`,
  uniswapV4: `uniswapV4(${POOL}, ${A}, ${B}, amount, 500n, 10n, 0n, 0n, minOut, ctx.self())`,
  maverickV2: `maverickV2(${POOL}, ${A}, ${B}, amount, minOut, ctx.self())`,
  tryDodoV2: `tryDodoV2(${POOL}, ${A}, ${B}, amount, ${B}, ${A}, minOut, ctx.self())`,
  tryWoofi: `tryWoofi(${POOL}, ${A}, ${B}, amount, minOut, ctx.self())`,
  tryUniswapV3: `tryUniswapV3(${POOL}, ${A}, ${B}, amount, 0n, minOut, ctx.self())`,
  tryUniswapV4: `tryUniswapV4(${POOL}, 0n, ${B}, amount, 500n, 10n, 0n, 0n, minOut, ctx.self())`,
  tryMaverickV2: `tryMaverickV2(${POOL}, ${A}, ${B}, amount, minOut, ctx.self())`,
  infinityCL: `infinityCL(${VAULT}, ${A}, ${B}, amount, ${POOL}, 500n, ${PARAMETERS}, 0n, 0n, minOut, ctx.self())`,
  tryInfinityCL: `tryInfinityCL(${VAULT}, ${B}, 0n, amount, ${POOL}, 500n, ${PARAMETERS}, 0n, 0n, minOut, ctx.self())`,
  infinityBin: `infinityBin(${VAULT}, ${A}, ${B}, amount, ${POOL}, 500n, ${PARAMETERS}, 0n, minOut, ctx.self())`,
  tryInfinityBin: `tryInfinityBin(${VAULT}, ${A}, ${B}, amount, ${POOL}, 500n, ${PARAMETERS}, 0n, minOut, ctx.self())`,
};

/** A program that calls `name` once and returns what it received. */
export const programCalling = (name: string): string =>
  `import { ${name} } from "@sauce/router";\n` +
  `function main(amount: Uint256, minOut: Uint256): Uint256 {\n  return ${FUNCTIONS[name]};\n}\n`;
