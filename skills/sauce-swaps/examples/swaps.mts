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

// On Solana: the SVM arm exports, for each venue the skill names, a `try` form and a plain form at a
// price and at its own limit, its instruction alone and its instruction's data (Orca's two); and
// `trySwap`/`swap`. Each family takes the arguments the skill gives.
const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const solana = skill.slice(skill.indexOf("## On Solana"), skill.indexOf("## Example"));
const svmArm = resolveSdkModule(entry.replace(/\.js$/, ".svm.js"));
if (svmArm === undefined) throw new Error("@sauce/router has an SVM arm");
const svmText = new TextDecoder().decode(svmArm);
const svmExports = [...svmText.matchAll(/^export function (\w+)\(([^)]*)\)/gm)];
const named = [...new Set([...solana.matchAll(/`(try[A-Z]\w+)`/g)].map((m) => m[1]!))];
const priced = named.filter((name) => !name.endsWith("AtLimit") && name !== "tryManifest");
check(priced.length === 10, "the skill names nine venues' try forms and trySwap");
const atLimit = [
  ...priced.filter((name) => name !== "trySwap").map((name) => `${name}AtLimit`),
  "tryInvariantAtLimit",
  "tryOpenbookV2AtLimit",
  "tryManifest",
];
for (const name of ["tryInvariantAtLimit", "tryOpenbookV2AtLimit", "tryManifest"])
  check(named.includes(name), `the skill names ${name}`);
const plainOf = (name: string) => name.charAt(3).toLowerCase() + name.slice(4);
const cpi = atLimit.map((name) => `${plainOf(name).replace(/AtLimit$/, "")}Cpi`);
const data = [
  ...cpi.map((name) => name.replace(/Cpi$/, "Data")),
  "orcaWhirlpoolV2Data",
  "openbookV2LotsData",
];
check(
  svmExports
    .map((m) => m[1])
    .sort()
    .join() ===
    [...priced, ...priced.map(plainOf), ...atLimit, ...atLimit.map(plainOf), ...cpi, ...data]
      .sort()
      .join(),
  "the SVM arm exports those, their plain forms and each venue's instruction alone and its data, and nothing else",
);
const signature = "slot, trader, amountIn, maxPrice, minOut, recipient";
check(solana.includes(`trySwap(${signature}): Uint256`), "the skill gives trySwap's arguments");
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
for (const [, name, args] of svmExports) {
  const want = name!.endsWith("Data")
    ? /^(amountIn|baseLots, quoteLots)\b/
    : name!.endsWith("Cpi")
      ? /^program, accounts, source, amountIn\b/
      : name!.endsWith("AtLimit") || name === "tryManifest" || name === "manifest"
        ? /^slot, trader, amountIn, (limit|ticks|priceLots, orders), minOut, recipient$|^slot, trader, amountIn, minOut, recipient$/
        : new RegExp(`^${signature}$`);
  check(want.test(argsOf(args!)), `${name}(${argsOf(args!)})`);
}
// What a program carries: one venue's function, or all nine through trySwap.
const block = /```sauce chain=solana\n([\s\S]*?)```/.exec(solana)![1]!;
const one = routes.compileSauceProgram("solana", block).bytecode.length;
const all = routes.compileSauceProgram("solana", block.replaceAll("orcaWhirlpool", "trySwap"))
  .bytecode.length;
const kb = (bytes: number) => (bytes / 1000).toFixed(1);
check(
  solana.includes(`about ${kb(one)} KB of program`) &&
    solana.replace(/\s+/g, " ").includes(`all nine, about ${kb(all)} KB`),
  `one venue's function is ${one} bytes of program, trySwap ${all}`,
);
console.log(`@sauce/router on Solana: ${named.join(", ")}; ${one} and ${all} bytes`);
