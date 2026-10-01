// Compiles swap-leg.sauce.ts for Base and Arbitrum the way `sauce compile` does, and pins the facts
// the sauce-swaps skill states: the functions `@sauce/router` exports and their argument order, the
// Router entry points that take a sqrt-price limit, which pool callbacks the Router services, and
// what a callback is held to. Offline: nothing is sent.
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
};
for (const [name, args] of Object.entries(LIBRARY)) {
  check(params(name) === args, `@sauce/router's ${name}(${args})`);
}
for (const name of ["UniswapV2", "Curve", "BalancerV2", "TraderJoeLB"]) {
  const base = name.charAt(0).toLowerCase() + name.slice(1);
  check(params(`try${name}`) === params(base), `try${name} takes ${base}'s arguments`);
}
for (const name of ["DodoV2", "Woofi"]) {
  check(params(`try${name}`) === undefined, `${name} has no try form`);
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
    "vault,key,zeroForOne,amountSpecified,sqrtPriceLimitX96,payer,recipient,callback",
  "PancakeSwap Infinity CL takes a limit",
);
check(
  inputs("swapInfinityBin").join() ===
    "vault,key,swapForY,amountSpecified,payer,recipient,callback",
  "PancakeSwap Infinity Bin has no limit",
);

// The pool callbacks the Router services: which pool families `uniswapV3`/`uniswapV4` can drive.
for (const callback of [
  "uniswapV3SwapCallback",
  "pancakeV3SwapCallback",
  "algebraSwapCallback",
  "synthraV3SwapCallback",
  "unitFlowV3SwapCallback",
  "unlockCallback",
]) {
  check(has(callback), `the Router implements ${callback}`);
}

// What a callback is held to: the pool must be the requested pair, and it is paid at most the
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
check(errors.includes("InvalidPool"), "a pool that is not the requested pair is refused");
check(errors.includes("InputExceedsAuthorized"), "a callback takes at most the exact input");
console.log(`@sauce/router: ${Object.keys(LIBRARY).join(", ")}`);
