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
 *  (Orca's two: `swap`'s and `swap_v2`'s; OpenBook's two: from an amount and from lots); and
 *  Manifest's. */
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
  "openbookV2LotsData",
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
  svmExactInArguments(name) ??
  (/^(raydiumClmm|pancakeswapClmm|byreal|stabbleClmm)Cpi$/.test(name)
    ? ["amountIn", "limit", "minOut"]
    : /^(orcaWhirlpool|cropper|defituna|crema)Cpi$/.test(name)
      ? ["amountIn", "limit", "minOut", "aToB"]
      : name === "phoenixCpi"
        ? ["amountIn", "ticks", "paysBase"]
        : name === "invariantCpi"
          ? ["amountIn", "limit", "xToY"]
          : name === "manifestCpi"
            ? ["amountIn", "minOut", "paysBase"]
            : ["amountIn", "priceLots", "orders", "paysBase"]);
/** A `…Data` function's arguments, by venue: what its instruction carries, and its direction. */
export const svmDataArguments = (name: string): string[] =>
  name === "phoenixData"
    ? ["amountIn", "lot", "ticks", "paysBase"]
    : name === "openbookV2Data"
      ? ["amountIn", "baseLot", "quoteLot", "priceLots", "orders", "paysBase"]
      : name === "openbookV2LotsData"
        ? ["baseLots", "quoteLots", "priceLots", "orders", "paysBase"]
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

/**
 * The SVM arm's exact-input venues with a slot, by the base name of their three functions
 * (`<venue>`, `try<Venue>`, `<venue>Cpi`), with the number of accounts each one's slot takes.
 */
export const SVM_EXACT_IN: Readonly<Record<string, number>> = {
  raydiumCpSwap: 7,
  gamma: 7,
  raydiumAmmV4: 5,
  orcaLegacyTokenSwap: 7,
  tokenSwapV1: 7,
  orcaV1: 7,
  penguin: 7,
  stepn: 7,
  saros: 7,
  fluxbeam: 7,
  dexlab: 7,
  meteoraDammV2: 6,
  meteoraDammV1: 13,
  aldrin: 7,
  omnipair: 7,
  saber: 7,
  saberDecimalsWrapper: 4,
  stabbleStableSwap: 10,
  stabbleWeightedSwap: 10,
  mercurial: 5,
  perena: 5,
  metadaoFutarchy: 5,
  solfiV2: 7,
  hadron: 12,
  taurusfi: 8,
  riptide: 6,
  denali: 6,
  gavel: 5,
  tesserav: 8,
  flint: 6,
  deriverse: 11,
  goonfiV2: 8,
  meteoraDbc: 7,
  trends: 7,
  heaven: 10,
  virtuals: 6,
  xorca: 4,
  solayer: 5,
  voltr: 8,
  vaultLiquidUnstake: 9,
  hyloStabilityPool: 10,
  huma: 8,
  heliumTreasury: 6,
};

/** The exact-input venues whose swap takes more accounts than a function can list: a `Cpi` form
 *  alone. */
export const SVM_CPI_ONLY = [
  "scaleAmm",
  "pumpswap",
  "bonkswap",
  "guacswap",
  "meteoraDlmm",
  "sarosDlmm",
  "raydiumLaunchlab",
  "runnerRodeo",
  "scaleVmm",
  "jupiterLendEarn",
  "hylo",
  "carrot",
  "mswap",
  "perpsJlp",
  "perpsJlpMint",
  "sanctumInfinity",
] as const;

const capitalized = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** Every exact-input function taking a slot, with the number of accounts its slot takes. */
export const SVM_EXACT_IN_FUNCTIONS: readonly [string, number][] = Object.entries(
  SVM_EXACT_IN,
).flatMap(([base, slot]) => [
  [base, slot],
  [`try${capitalized(base)}`, slot],
]);

/** Every exact-input `Cpi` form. */
export const SVM_CPI_FUNCTIONS: readonly string[] = [
  ...Object.keys(SVM_EXACT_IN),
  ...SVM_CPI_ONLY,
].map((base) => `${base}Cpi`);

const svmAccounts = (names: readonly string[]): string =>
  names
    .map((account) => `  ${account}: ${account === "authority" ? "Account<Signer>" : "Account"},`)
    .join("\n");

/**
 * A Solana program that calls the exact-input function `name` once on a slot of `slotLength`
 * accounts: the slot, the trader's seven and the recipient as `main`'s accounts, the amount and the
 * floor as its arguments. With `name` empty, the same program calling nothing: the base a function's
 * compute units are measured over.
 */
export const svmExactInProgramCalling = (name: string, slotLength: number): string => {
  const slot = Array.from({ length: slotLength }, (_, i) => `s${i}`);
  const head =
    `function main(\n${svmAccounts([...slot, ...SVM_TRADER, "recipient"])}\n` +
    `  amountIn: Uint256,\n  minOut: Uint256,\n): Uint256 {\n`;
  if (name === "") return `${head}  return 0;\n}\n`;
  return (
    `import { ${name} } from "@sauce/router";\n${head}` +
    `  return ${name}([${slot.join(", ")}], [${SVM_TRADER.join(", ")}], amountIn, minOut, recipient);\n}\n`
  );
};

/** The exact-input venues' `…Cpi` and `…Data` arguments past `amountIn`, where they are not just
 *  `minOut`: what the instruction carries, its floor (none where it carries none), and the direction
 *  where the data says it. */
export const SVM_EXACT_IN_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  aldrin: ["minOut", "paysBase"],
  saberDecimalsWrapper: ["aToB"],
  perena: ["inIndex", "outIndex", "minOut"],
  metadaoFutarchy: ["minOut", "paysBase"],
  scaleAmm: ["minOut", "aToB"],
  pumpswap: ["minOut", "paysBase"],
  bonkswap: ["xToY"],
  guacswap: ["xToY"],
  sarosDlmm: ["minOut", "xToY"],
  solfiV2: ["minOut", "aToB"],
  hadron: ["minOut", "aToB"],
  taurusfi: [],
  riptide: ["aToB"],
  denali: ["minOut", "aToB"],
  gavel: ["minOut", "paysBase"],
  flint: [],
  deriverse: ["instrId", "minOut", "paysBase"],
  goonfiV2: ["minOut", "aToB"],
  heaven: ["minOut", "aToB"],
  raydiumLaunchlab: ["minOut", "paysBase"],
  scaleVmm: ["minOut", "aToB"],
  xorca: [],
  solayer: ["aToB"],
  voltr: ["aToB"],
  vaultLiquidUnstake: [],
  hyloStabilityPool: ["aToB"],
  huma: [],
  jupiterLendEarn: ["aToB"],
  hylo: ["aToB"],
  carrot: ["aToB"],
  mswap: [],
  sanctumInfinity: ["inCalcAccounts", "outCalcAccounts", "inIndex", "outIndex", "minOut"],
};

/** An exact-input venue's `…Cpi` or `…Data` arguments, `amountIn` first; undefined for any other
 *  function. */
export const svmExactInArguments = (name: string): string[] | undefined => {
  const base = name.replace(/(Cpi|Data)$/, "");
  if (
    base === name ||
    !(base in SVM_EXACT_IN || (SVM_CPI_ONLY as readonly string[]).includes(base))
  )
    return undefined;
  return ["amountIn", ...(SVM_EXACT_IN_ARGUMENTS[base] ?? ["minOut"])];
};

/** Every exact-input `Data` form. */
export const SVM_DATA_FUNCTIONS: readonly string[] = [
  ...Object.keys(SVM_EXACT_IN),
  ...SVM_CPI_ONLY,
].map((base) => `${base}Data`);

/**
 * A Solana program that sends an exact-input venue's instruction once: the venue's program, a list
 * of `length` accounts and the paying account as `main`'s accounts; `amountIn` and the arguments
 * `baked` does not write as literals as `main`'s. `form` is `name`'s `Cpi` (returning what it
 * returns), its `Data` (sending the data itself, returning what `source` paid), `hand` (the data
 * written by hand around the amount, `baked.prefix` then `baked.suffix`, as a code generator's
 * template does) or `none` (nothing: the base the others' compute units are measured over).
 */
export const svmInstructionProgram = (
  form: "Cpi" | "Data" | "hand" | "none",
  name: string,
  length: number,
  baked: Readonly<Record<string, string>> = {},
): string => {
  const list = Array.from({ length }, (_, i) => `a${i}`);
  const all =
    form === "Cpi" || form === "Data" ? svmExactInArguments(`${name}${form}`)! : ["amountIn"];
  const args = all.filter((arg) => !Object.hasOwn(baked, arg));
  const head =
    (form === "Cpi" || form === "Data"
      ? `import { ${name}${form} } from "@sauce/router";
`
      : "") +
    `function main(\n${svmAccounts(["program", ...list, "source"])}\n` +
    args.map((arg) => `  ${arg}: Uint256,\n`).join("") +
    `): Uint256 {\n`;
  const call = all
    .map((arg) => baked[arg] ?? (DIRECTIONS.has(arg) ? `${arg} != 0` : arg))
    .join(", ");
  const send = (data: string) =>
    `  const data = ${data};\n` +
    `  const held = svm.sload(source, 64, 8).toLe();\n` +
    `  svm.call(program, [${list.join(", ")}], data);\n` +
    `  return held - svm.sload(source, 64, 8).toLe();\n}\n`;
  if (form === "none") return `${head}  return 0;\n}\n`;
  if (form === "Cpi")
    return `${head}  return ${name}Cpi(program, [${list.join(", ")}], source, ${call});\n}\n`;
  if (form === "Data") return head + send(`${name}Data(${call})`);
  const suffix = baked.suffix ? `, hex\`${baked.suffix}\`` : "";
  return (
    head +
    `  const prefix = hex\`${baked.prefix}\`;\n` +
    send(`prefix.concat(amountIn.toBytesLe(8)${suffix})`)
  );
};
