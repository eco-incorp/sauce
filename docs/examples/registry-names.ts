// The registry's names in both languages: venue-where-deployed.sauce.ts compiled for two chains,
// and the same contracts and tokens from host TypeScript.
//
// Everything that runs here is offline: the Pot and engine are fixtures and nothing is sent. The
// read helper at the bottom is typechecked, and reads chain state only when your application calls
// it with a client.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base, Optimism, routes } from "@eco-incorp/sauce";
import type { PublicClient } from "viem";

const program = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "venue-where-deployed.sauce.ts"),
  "utf8",
);
const execution = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;

// Base has PancakeSwap V3; Optimism does not, so there the program asks Uniswap V3.
const onBase = routes.compileSauceRoute("base", program, execution);
const onOptimism = routes.compileSauceRoute("optimism", program, execution);
const calls = (bytecode: Uint8Array, factory: string | undefined) =>
  factory !== undefined &&
  Array.from(bytecode, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .includes(factory.slice(2).toLowerCase());
if (!calls(onBase.compiled.bytecode[0]!, Base.PancakeswapV3.Factory.address)) {
  throw new Error("Expected Base to call PancakeSwap V3's factory");
}
if (
  Optimism.PancakeswapV3.Factory.available ||
  !calls(onOptimism.compiled.bytecode[0]!, Optimism.UniswapV3.Factory.address)
) {
  throw new Error("Expected Optimism to fall back to Uniswap V3's factory");
}

// The same names on the host: a token is its registry row, a contract call is typed from its ABI.
const usdc = Base.USDC; // { address, decimals, symbol, chain }
const getPool = Base.PancakeswapV3.Factory.getPool(usdc.address, Base.WETH.address, 500);
if (usdc.decimals !== 6 || !getPool.data.startsWith("0x1698ee82")) {
  throw new Error("Expected Base's USDC row and an encoded getPool call");
}
console.log("Base pool lookup:", getPool.toCall());

// Call with a client for Base. Importing this example performs no RPC.
export async function readBasePool(client: PublicClient): Promise<`0x${string}`> {
  return Base.PancakeswapV3.Factory.getPool(Base.USDC.address, Base.WETH.address, 500).read(client);
}
