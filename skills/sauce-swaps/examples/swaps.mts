// Compiles swap-leg.sauce.ts for Base and Arbitrum the way `sauce compile` does, and pins the
// Router facts the sauce-swaps skill states: which entry points take a sqrt-price limit, which pool
// callbacks the Router services, and the unified entry point's pool types and exact-input signs.
// Offline: nothing is sent.
//
//   node swaps.mts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { routes, swap } from "@eco-incorp/sauce";
import { resolveSdkModule } from "@eco-incorp/sauce/compiler";

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
  console.log(`guarded V3 leg on ${slug}: ${leg.bytecode.length} bytes`);
}

// The Router ABI the program imports as ./artifacts/ISauceRouter.json.
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

// Entry points and their price-limit parameter.
check(
  inputs("swapV3").join() ===
    "pool,tokenIn,tokenOut,amountSpecified,sqrtPriceLimitX96,payer,recipient",
  "swapV3",
);
check(
  inputs("swapV4").join() ===
    "poolManager,key,zeroForOne,amountSpecified,sqrtPriceLimitX96,payer,recipient",
  "swapV4",
);
check(
  inputs("swapInfinityCL").includes("sqrtPriceLimitX96"),
  "PancakeSwap Infinity CL takes a limit",
);
check(inputs("swapMaverickV2Bounded").includes("tickLimit"), "Maverick V2 is bounded by a tick");
check(
  !inputs("swapInfinityBin").includes("sqrtPriceLimitX96"),
  "PancakeSwap Infinity Bin has no limit",
);

// The pool callbacks the Router services: which pool families swapV3/swapV4 can drive.
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

// The unified swap(SwapParams): pool types, and exact input's sign per type.
const types = Object.entries(swap.SwapPoolType).map(([name, value]) => ({
  name,
  value,
  poolKey: swap.usesPoolKey(value),
  callback: swap.isCallbackVenue(value),
  negative: swap.amountSpecifiedFor(value, 5n) !== 5n,
}));
const names = (keep: (t: (typeof types)[number]) => boolean) =>
  types
    .filter(keep)
    .map((t) => t.name)
    .join();
check(
  types.map((t) => `${t.name}=${t.value}`).join() ===
    "UniV2=0,UniV3=1,UniV4=2,Curve=3,BalancerV2=4,DODOV2=5,TraderJoeLB=6,MaverickV2=7,WOOFi=8",
  "pool types",
);
check(names((t) => t.negative) === "UniV4", "only V4 takes exact input as negative");
check(names((t) => t.callback) === "UniV3,UniV4,MaverickV2", "callback venues");
check(names((t) => t.poolKey) === "UniV2,UniV4", "poolKey users");
