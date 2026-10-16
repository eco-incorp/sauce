// Compiles swap-leg.sauce.ts for Base and Arbitrum the way `sauce compile` does, and pins the facts
// the sauce-swaps skill states: the functions `@sauce/router` exports and their argument order, the
// Router entry points that take a sqrt-price limit, which pool callbacks the Router services, what a
// callback is held to, and, on Solana, the library's functions, their arguments and what a program
// calling one or all of them weighs. Offline: nothing is sent.
//
//   node swaps.mts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { routes } from "@eco-incorp/sauce";
import { resolveSdkModule, resolveSdkPackage } from "@eco-incorp/sauce/compiler";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const source = readFileSync(new URL("./swap-leg.sauce.ts", import.meta.url), "utf8");
for (const slug of ["base", "arbitrum"]) {
  const leg = routes.compileSauceProgram(slug, source);
  check(
    leg.entryParams.map((param) => `${param.name}: ${param.type}`).join(", ") ===
      "tokenIn: Address, tokenOut: Address, fee: Uint256, amountIn: Uint256, " +
        "sqrtPriceLimitX96: Uint256, minOut: Uint256, recipient: Address",
    "main's inputs, as --args takes them",
  );
  check(/from "@sauce\/router"/.test(leg.source), "the leg swaps through @sauce/router");
  console.log(`guarded V3 leg on ${slug}: ${leg.bytecode.length} bytes`);
}

// The library the package serves for `import ... from "@sauce/router"`: its EVM arm, and every
// function the skill lists, with its arguments in the order the skill gives them.
const entry = resolveSdkPackage("@sauce/router");
if (entry === undefined) throw new Error("the SDK serves @sauce/router");
const library = resolveSdkModule(entry.replace(/\.js$/, ".evm.js"));
if (library === undefined) throw new Error("@sauce/router has an EVM arm");
const text = new TextDecoder().decode(library);
const params = (name: string) => {
  const found = new RegExp(`export function ${name}\\(([^)]*)\\)`).exec(text);
  return found?.[1]
    ?.split(",")
    .map((p) => p.trim().split(":")[0]!.trim())
    .filter(Boolean)
    .join(", ");
};
const LIBRARY = {
  uniswapV2: "pair, tokenIn, tokenOut, amountIn, feePpm, minOut, recipient",
  uniswapV3: "pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient",
  uniswapV4:
    "poolManager, tokenIn, tokenOut, amountIn, fee, tickSpacing, hooks, sqrtPriceLimitX96, minOut, recipient",
  curve: "pool, tokenIn, tokenOut, amountIn, i, j, uint256Indices, minOut, recipient",
  balancerV2: "vault, tokenIn, tokenOut, amountIn, poolId, minOut, recipient",
  dodoV2: "pool, tokenIn, tokenOut, amountIn, baseToken, quoteToken, minOut, recipient",
  traderJoeLB: "pair, tokenIn, tokenOut, amountIn, tokenX, tokenY, minOut, recipient",
  woofi: "pool, tokenIn, tokenOut, amountIn, minOut, recipient",
  maverickV2: "pool, tokenIn, tokenOut, amountIn, minOut, recipient",
  infinityCL:
    "vault, tokenIn, tokenOut, amountIn, poolManager, fee, parameters, hooks, sqrtPriceLimitX96, minOut, recipient",
  infinityBin:
    "vault, tokenIn, tokenOut, amountIn, poolManager, fee, parameters, hooks, minOut, recipient",
};
for (const [name, args] of Object.entries(LIBRARY)) {
  check(params(name) === args, `@sauce/router's ${name}(${args})`);
}
for (const name of [
  "UniswapV2",
  "Curve",
  "BalancerV2",
  "DodoV2",
  "TraderJoeLB",
  "Woofi",
  "UniswapV3",
  "UniswapV4",
  "MaverickV2",
  "InfinityCL",
  "InfinityBin",
]) {
  const base = name.charAt(0).toLowerCase() + name.slice(1);
  check(params(`try${name}`) === params(base), `try${name} takes ${base}'s arguments`);
}

// The Router ABI the package serves, which `@sauce/router` calls for the venues that call back.
interface AbiFunction {
  type: string;
  name: string;
  inputs: { name: string }[];
}
const served = resolveSdkModule("./artifacts/ISauceRouter.json");
if (served === undefined) throw new Error("the SDK serves ISauceRouter.json");
const parsed = JSON.parse(new TextDecoder().decode(served)) as
  AbiFunction[] | { abi: AbiFunction[] };
const abi = (Array.isArray(parsed) ? parsed : parsed.abi).filter((f) => f.type === "function");
const has = (name: string) => abi.some((f) => f.name === name);
const inputs = (name: string) => abi.find((f) => f.name === name)?.inputs.map((i) => i.name) ?? [];

check(inputs("swapV3").includes("sqrtPriceLimitX96"), "swapV3 takes a limit");
check(inputs("swapV4").includes("sqrtPriceLimitX96"), "swapV4 takes a limit");
check(
  inputs("swapInfinityCL").join() ===
    "vault,key,tokenIn,zeroForOne,amountIn,sqrtPriceLimitX96,recipient",
  "PancakeSwap Infinity CL takes a limit",
);
check(
  inputs("swapInfinityBin").join() === "vault,key,tokenIn,swapForY,amountIn,recipient",
  "PancakeSwap Infinity Bin has no limit",
);

// The pool callbacks the Router services: which pool families the Router-routed functions drive.
for (const callback of [
  "uniswapV3SwapCallback",
  "pancakeV3SwapCallback",
  "algebraSwapCallback",
  "synthraV3SwapCallback",
  "unitFlowV3SwapCallback",
  "unlockCallback",
  "maverickV2SwapCallback",
  "lockAcquired",
]) {
  check(has(callback), `the Router implements ${callback}`);
}

// What a callback is held to: the input token must match the pool key, and it is paid at most the
// exact input. The deployed Router's full ABI ships beside the package's other artifacts.
const routerAbi = (
  JSON.parse(
    readFileSync(
      join(
        dirname(createRequire(import.meta.url).resolve("@eco-incorp/sauce")),
        "artifacts/Router.json",
      ),
      "utf8",
    ),
  ) as { abi: { type: string; name?: string }[] }
).abi;
const errors = routerAbi.filter((entry) => entry.type === "error").map((entry) => entry.name);
check(
  errors.includes("InputTokenMismatch"),
  "an input token inconsistent with the pool key is refused",
);
check(errors.includes("InputExceedsAuthorized"), "a callback takes at most the exact input");
console.log(`@sauce/router: ${Object.keys(LIBRARY).join(", ")}`);

// On Solana: the SVM arm exports, for each venue the skill names, one function at a price and one at
// its own limit, its instruction alone and its instruction's data (Orca's two); and `swap`, at any of
// them. No `try` form: each returns 0 where the pool cannot trade. Each family takes the arguments
// the skill gives.
const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const section = (heading: string): string => {
  const start = skill.indexOf(`## ${heading}`);
  return skill.slice(start, skill.indexOf("\n## ", start + 1));
};
const solana = section("On Solana");
const exact = section("Exact input on Solana");
const svmArm = resolveSdkModule(entry.replace(/\.js$/, ".svm.js"));
if (svmArm === undefined) throw new Error("@sauce/router has an SVM arm");
const svmText = new TextDecoder().decode(svmArm);
const svmExports = [...svmText.matchAll(/^export function (\w+)\(([^)]*)\)/gm)];
const functions = solana.slice(solana.indexOf("### The functions"));
const priced = [
  ...functions.slice(0, functions.indexOf("Every one takes")).matchAll(/`([a-z]\w+)`/g),
].map((m) => m[1]!);
check(
  priced.length === 11 && priced.includes("swap"),
  "the skill names ten venues' functions and swap",
);
// Meteora DLMM's swap has no limit of its own: no `…AtLimit`, and its `…Cpi` and `…Data` its exact
// input's.
const atLimit = [
  ...priced
    .filter((name) => name !== "swap" && name !== "meteoraDlmm")
    .map((name) => `${name}AtLimit`),
  "invariantAtLimit",
  "openbookV2AtLimit",
  "manifest",
];
for (const name of ["invariantAtLimit", "openbookV2AtLimit", "manifest"])
  check(solana.includes(`\`${name}\``), `the skill names ${name}`);
check(
  svmExports.every((m) => !/^try[A-Z]/.test(m[1]!)),
  "the SVM arm has no try form: each function returns 0 where the pool cannot trade",
);
const cpi = atLimit.map((name) => `${name.replace(/AtLimit$/, "")}Cpi`);
const data = [
  ...cpi.map((name) => name.replace(/Cpi$/, "Data")),
  "orcaWhirlpoolV2Data",
  "openbookV2LotsData",
];
const limit = new Set([...priced, ...atLimit, ...cpi, ...data]);
check(
  svmExports
    .map((m) => m[1]!)
    .filter((name) => limit.has(name))
    .sort()
    .join() === [...limit].sort().join(),
  "the SVM arm exports those and each venue's instruction alone and its data",
);
const signature = "slot, trader, amountIn, maxPrice, minOut, recipient";
check(solana.includes(`swap(${signature}): Uint256`), "the skill gives swap's arguments");
check(
  solana.replace(/\s+/g, " ").includes("(slot, trader, amountIn, limit, minOut, recipient)") &&
    solana.includes("`<venue>Cpi(program, accounts, source, amountIn, …)`") &&
    solana.includes("`<venue>Data(amountIn, …)`"),
  "the skill gives the other three forms' arguments",
);
const argsOf = (args: string) =>
  args
    .split(",")
    .map((p) => p.trim().split(":")[0]!.trim())
    .filter(Boolean)
    .join(", ");
for (const [, name, args] of svmExports.filter((m) => limit.has(m[1]!))) {
  const want = name!.endsWith("Data")
    ? /^(amountIn|baseLots, quoteLots)\b/
    : name!.endsWith("Cpi")
      ? /^program, accounts, source, amountIn\b/
      : name!.endsWith("AtLimit") || name === "manifest"
        ? /^slot, trader, amountIn, (limit|ticks|priceLots, orders), minOut, recipient$|^slot, trader, amountIn, minOut, recipient$/
        : new RegExp(`^${signature}$`);
  check(want.test(argsOf(args!)), `${name}(${argsOf(args!)})`);
}
// The exact-input venues: each one the skill names exported plain, as `Cpi` and as `Data`, the ones it
// names with `Cpi` and `Data` forms alone as those, and nothing else.
const listed = exact.slice(
  exact.indexOf("The venues:"),
  exact.indexOf("\n\n", exact.indexOf("The venues:")),
);
const venues = [...listed.matchAll(/`([a-z]\w+)`/g)].map((m) => m[1]!);
const instructionOnly = [...exact.matchAll(/`(\w+(?:Cpi|Data))`/g)]
  .map((m) => m[1]!)
  .filter((name) => !name.startsWith("raydiumCpSwap"));
check(
  svmExports
    .map((m) => m[1]!)
    .filter((name) => !limit.has(name))
    .sort()
    .join() ===
    [...venues.flatMap((v) => [v, `${v}Cpi`, `${v}Data`]), ...instructionOnly].sort().join(),
  "the SVM arm exports the exact-input venues' three forms, and the Cpi-only venues' two",
);
const exactSignature = "slot, trader, amountIn, minOut, recipient";
check(
  exact.includes(`raydiumCpSwap(${exactSignature}): Uint256`) &&
    exact.includes("raydiumCpSwapCpi(program, accounts, source, amountIn, minOut): Uint256") &&
    exact.includes("raydiumCpSwapData(amountIn, minOut): bytes"),
  "the skill gives the exact-input forms' arguments",
);
for (const [, name, args] of svmExports.filter((m) => !limit.has(m[1]!)))
  check(
    name!.endsWith("Data")
      ? /^amountIn\b/.test(argsOf(args!))
      : name!.endsWith("Cpi")
        ? /^program, accounts, source, amountIn\b/.test(argsOf(args!))
        : argsOf(args!) === exactSignature,
    `${name}'s arguments`,
  );
// What a program carries: one venue's function, or all ten through swap.
const block = [...solana.matchAll(/```sauce chain=solana\n([\s\S]*?)```/g)]
  .map((match) => match[1]!)
  .find((code) => code.includes('from "@sauce/router"'))!;
const one = routes.compileSauceProgram("solana", block).bytecode.length;
const all = routes.compileSauceProgram("solana", block.replaceAll("orcaWhirlpool", "swap")).bytecode
  .length;
const kb = (bytes: number) => (bytes / 1000).toFixed(1);
check(
  solana.includes(`about ${kb(one)} KB of program`) &&
    solana.replace(/\s+/g, " ").includes(`all ten, about ${kb(all)} KB`),
  `one venue's function is ${one} bytes of program, swap ${all}`,
);
console.log(`@sauce/router on Solana: ${priced.join(", ")}; ${one} and ${all} bytes`);

// A venue by its namespace: the skill names every venue `sauce globals --chain solana` lists, and
// the example compiles to that venue's own function, never swap, its pool's nine accounts and the
// Pot's added to main with how each is derived.
const namespaces = routes.sourceGlobals("solana").venues.map((venue) => venue.namespace);
for (const namespace of namespaces)
  check(solana.includes(`\`${namespace}\``), `the skill names ${namespace}`);
const example = routes.compileSauceProgram(
  "solana",
  readFileSync(new URL("./solana-swap.sauce.ts", import.meta.url), "utf8"),
);
check(
  example.source.includes("__sauce_orcaWhirlpool(") && !example.source.includes("{ swap as"),
  "Orca.Whirlpool.swap compiles to orcaWhirlpool",
);
const derived = example.derivedAccounts ?? {};
for (const part of ["program", "pool", "vaultA", "ticks2"])
  check(
    Object.values(derived).includes(`slot:@pool:USDC.${part}`),
    `the pool's ${part} is derived`,
  );
check(
  derived.potWSOL === "self:WSOL" && derived.toWSOL === "@to:WSOL",
  "what is bought lands in the Pot's WSOL account, and goes on to to's",
);
check(solana.includes("`slot:@pool:USDC.vaultA`"), "the skill shows a slot derivation");
check(
  example.entryParams.map((param) => param.name).join() === "pool,to,amountIn,maxPrice,minOut",
  "the example's arguments are its own; the accounts are none of them",
);
console.log(
  `Solana venues by namespace: ${namespaces.join(", ")}; the example ${example.bytecode.length} bytes`,
);
console.log(
  `@sauce/router exact input on Solana: ${venues.length} venues in four forms, ${instructionOnly.join(", ")}`,
);
