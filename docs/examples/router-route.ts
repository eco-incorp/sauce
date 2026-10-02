// Compiles router-route.sauce.ts once, then gives it a route as runtime arguments: the program a Pot
// cooks is the bytecode followed by the ABI-encoded legs, so one compile serves every route over its
// venues. Offline: the route is Ethereum's, but nothing is sent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile, resolveSdkModule, resolveSdkPackage } from "@eco-incorp/sauce/compiler";
import { concatHex, encodeAbiParameters, toHex, type Address, type Hex } from "viem";

const source = new TextEncoder().encode(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "router-route.sauce.ts"), "utf8"),
);

// A raw compile names the SDK's own modules: resolveSdkPackage maps `@sauce/router` (and the
// `@sauce/token` it imports) to the copies the SDK carries, and resolveSdkModule serves their files.
const { bytecode, entryEncoding } = compile({
  target: "evm",
  resolve: (path) => (path === "main.js" ? source : resolveSdkModule(path)),
  resolvePackage: (specifier) => resolveSdkPackage(specifier),
});
if (entryEncoding !== "abi-v1") throw new Error("Expected ABI-encoded arguments");

/** One leg, field for field the program's `Leg`. */
export interface Leg {
  venue: bigint;
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  i: bigint;
  j: bigint;
  poolId: bigint;
}

/** The `program` argument of Pot.cook for one route: the reusable bytecode, then the route. */
export function routeProgram(legs: readonly Leg[], amountIn: bigint, minOut: bigint): Hex {
  const args = encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "venue", type: "uint256" },
          { name: "pool", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "i", type: "uint256" },
          { name: "j", type: "uint256" },
          { name: "poolId", type: "uint256" },
        ],
      },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [legs, amountIn, minOut],
  );
  return concatHex([toHex(bytecode), args]);
}

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const none = { i: 0n, j: 0n, poolId: 0n };

// 1 WETH to USDC in Uniswap V3's 0.05% pool, then USDC to USDT in Curve's 3pool, where USDC is
// coin 1 and USDT coin 2.
export const legs: readonly Leg[] = [
  {
    venue: 1n,
    pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    tokenIn: WETH,
    tokenOut: USDC,
    ...none,
  },
  {
    venue: 3n,
    pool: "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7",
    tokenIn: USDC,
    tokenOut: USDT,
    i: 1n,
    j: 2n,
    poolId: 0n,
  },
];

// The whole route reverts unless it delivers at least 2,500 USDT (6 decimals).
export const program = routeProgram(legs, 10n ** 18n, 2_500_000_000n);
console.log(
  `route program: ${bytecode.length} bytes, plus ${(program.length - 2) / 2 - bytecode.length} of arguments`,
);
console.log(program.slice(0, 18));
