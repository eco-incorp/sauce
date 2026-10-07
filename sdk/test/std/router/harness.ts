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

/** An arm's source, for reading what it exports. */
export const routerSource = (target: SauceTarget = "evm"): string =>
  readFileSync(join(STD, "router", `router.${target}.js`), "utf8");

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

/** The nine accounts of a Solana pool's slot, then the trader's seven, as the SVM arm takes them. */
export const SVM_SLOT = [
  "program",
  "pool",
  "config",
  "vaultA",
  "vaultB",
  "extra",
  "ticks0",
  "ticks1",
  "ticks2",
] as const;
/** A slot's accounts past its nine, where a venue takes more (Raydium's bitmap extension, …). */
export const SVM_MORE = ["more0", "more1"] as const;
export const SVM_TRADER = [
  "authority",
  "source",
  "payMint",
  "buyMint",
  "tokenProgram",
  "token2022",
  "memo",
] as const;

/** The venues `@sauce/router`'s Solana arm swaps at, by the name its functions carry. */
export const SVM_VENUES = [
  "RaydiumClmm",
  "PancakeswapClmm",
  "Byreal",
  "StabbleClmm",
  "OrcaWhirlpool",
  "Cropper",
  "Defituna",
  "Crema",
  "Phoenix",
] as const;
/** The venues swapped only at a pool's own limit (or, Manifest, at none). */
export const SVM_LIMIT_VENUES = ["Invariant", "OpenbookV2"] as const;

const lower = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/** Every function of the SVM arm: `trySwap`/`swap`; each of the nine venues at a price, `try` and
 *  plain; each venue at its own limit, `try`, plain, its instruction alone and its instruction's data
 *  (Orca's two: `swap`'s and `swap_v2`'s); and Manifest's. */
export const SVM_FUNCTIONS = [
  "trySwap",
  "swap",
  ...SVM_VENUES.flatMap((venue) => [`try${venue}`, lower(venue)]),
  ...[...SVM_VENUES, ...SVM_LIMIT_VENUES].flatMap((venue) => [
    `try${venue}AtLimit`,
    `${lower(venue)}AtLimit`,
    `${lower(venue)}Cpi`,
    `${lower(venue)}Data`,
  ]),
  "orcaWhirlpoolV2Data",
  "tryManifest",
  "manifest",
  "manifestCpi",
  "manifestData",
] as const;

/** An instruction's own: `…Cpi`, which sends it, or `…Data`, which builds its data. */
export const svmInstructionForm = (name: string): boolean => /(Cpi|Data)$/.test(name);

/** A function's arguments after `slot` and `trader` and before `recipient`, by its family. */
export const svmArguments = (name: string): string[] =>
  /^(tryManifest|manifest)$/.test(name)
    ? ["amountIn", "minOut"]
    : /openbookV2/i.test(name)
      ? ["amountIn", "priceLots", "orders", "minOut"]
      : /AtLimit$/.test(name)
        ? ["amountIn", "limit", "minOut"]
        : ["amountIn", "maxPrice", "minOut"];

/** An instruction-only `…Cpi` function's arguments after `program`, `accounts` and `source`, by
 *  venue: what its instruction carries, and its direction. */
export const svmCpiArguments = (name: string): string[] =>
  /^(raydiumClmm|pancakeswapClmm|byreal|stabbleClmm)Cpi$/.test(name)
    ? ["amountIn", "limit", "minOut"]
    : /^(orcaWhirlpool|cropper|defituna|crema)Cpi$/.test(name)
      ? ["amountIn", "limit", "minOut", "aToB"]
      : name === "phoenixCpi"
        ? ["amountIn", "ticks", "paysBase"]
        : name === "invariantCpi"
          ? ["amountIn", "limit", "xToY"]
          : name === "manifestCpi"
            ? ["amountIn", "minOut", "paysBase"]
            : ["amountIn", "priceLots", "orders", "paysBase"];
/** A `…Data` function's arguments, by venue: what its instruction carries, and its direction. */
export const svmDataArguments = (name: string): string[] =>
  name === "phoenixData"
    ? ["amountIn", "lot", "ticks", "paysBase"]
    : name === "openbookV2Data"
      ? ["amountIn", "baseLot", "quoteLot", "priceLots", "orders", "paysBase"]
      : name === "orcaWhirlpoolV2Data"
        ? ["amountIn", "limit", "minOut", "aToB"]
        : svmCpiArguments(name.replace(/Data$/, "Cpi"));
/** The direction arguments, a `bool` each, which `main` takes as a number. */
const DIRECTIONS = new Set(["aToB", "xToY", "paysBase"]);

/** The role `main` declares each account with: what a swap signs with, and what it writes. */
const svmRole = (name: string): string =>
  name === "authority"
    ? "Account<Signer>"
    : ["program", "config", "payMint", "buyMint", "tokenProgram", "token2022", "memo"].includes(
          name,
        )
      ? "Account"
      : "Account<Writable>";

/**
 * A Solana program that calls `name` once and returns what it returned. A slot function takes the
 * slot's accounts (its nine, then `more` past them), the trader's seven and the recipient as `main`'s
 * accounts, then its arguments as `main`'s; an instruction-only `…Cpi` or `…Data` takes the venue's
 * program, the paying account and `more` accounts in the instruction's order, then its arguments, and
 * a `…Data` program builds the data, sends the instruction itself and returns what the paying account
 * paid. `baked` writes an instruction-only function's arguments it names as those literals, as a
 * program compiled for one trade does, in place of `main`'s; a direction, a `bool`, is otherwise
 * `main`'s number.
 */
export const svmProgramCalling = (
  name: string,
  more = 0,
  baked: Readonly<Record<string, string>> = {},
): string => {
  if (svmInstructionForm(name)) {
    const accounts = Array.from({ length: more }, (_, i) => `a${i}`);
    const all = name.endsWith("Data") ? svmDataArguments(name) : svmCpiArguments(name);
    const args = all.filter((arg) => !Object.hasOwn(baked, arg));
    const call = all
      .map((arg) => baked[arg] ?? (DIRECTIONS.has(arg) ? `${arg} != 0` : arg))
      .join(", ");
    const params = [
      "  program: Account,",
      "  source: Account<Writable>,",
      ...accounts.map((account) => `  ${account}: Account<Writable>,`),
      ...args.map((arg) => `  ${arg}: Uint256,`),
    ].join("\n");
    const head = `import { ${name} } from "@sauce/router";\nfunction main(\n${params}\n): Uint256 {\n`;
    if (name.endsWith("Cpi"))
      return `${head}  return ${name}(program, [${accounts.join(", ")}], source, ${call});\n}\n`;
    return (
      head +
      `  const data = ${name}(${call});\n` +
      `  const held = svm.sload(source, 64, 8).toLe();\n` +
      `  svm.call(program, [${accounts.join(", ")}], data);\n` +
      `  return held - svm.sload(source, 64, 8).toLe();\n}\n`
    );
  }
  const slot = [...SVM_SLOT, ...SVM_MORE.slice(0, more)];
  const accounts = [...slot, ...SVM_TRADER, "recipient"]
    .map((account) => `  ${account}: ${svmRole(account)},`)
    .join("\n");
  const args = svmArguments(name);
  return (
    `import { ${name} } from "@sauce/router";\n` +
    `function main(\n${accounts}\n${args.map((arg) => `  ${arg}: Uint256,`).join("\n")}\n): Uint256 {\n` +
    `  return ${name}([${slot.join(", ")}], [${SVM_TRADER.join(", ")}], ${args.join(", ")}, recipient);\n}\n`
  );
};
