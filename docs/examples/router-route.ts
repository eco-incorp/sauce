// Compiles router-route.sauce.ts once, then gives it a route as runtime arguments: the program a Pot
// cooks is the bytecode followed by the ABI-encoded legs, so one compile serves every route over its
// venues. Offline: the route is Ethereum's, but nothing is sent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ethereum } from "@eco-incorp/sauce";
import { compile, resolveSdkModule, resolveSdkPackage } from "@eco-incorp/sauce/compiler";
import { concatHex, encodeAbiParameters, toHex, type Address, type Hex } from "viem";

const source = new TextEncoder().encode(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "router-route.sauce.ts"), "utf8"),
);

// A raw compile names the SDK's own modules: resolveSdkPackage maps `@sauce/router` (and the
// `@sauce/token` it imports) to the copies the SDK carries, and resolveSdkModule serves their files.
const { bytecode } = compile({
  target: "evm",
  resolve: (path) => (path === "main.js" ? source : resolveSdkModule(path)),
  resolvePackage: (specifier) => resolveSdkPackage(specifier),
});

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

// The tokens and the 3pool are the registry's; the V3 pool is a pool, which the registry does not
// list (its factory finds it on chain).
const [WETH, USDC, USDT] = [Ethereum.WETH.address, Ethereum.USDC.address, Ethereum.USDT.address];
const threePool = Ethereum.Curve.ThreePool.address;
if (threePool === undefined) throw new Error("Expected Curve's 3pool on Ethereum");
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
    pool: threePool,
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
