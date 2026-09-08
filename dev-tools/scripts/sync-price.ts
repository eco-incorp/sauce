/**
 * CLI entry point for Uniswap V3 price sync.
 *
 * Usage: npm run sync-price <pool-address>
 *
 * Prerequisites: Run `npm run start:fork <rpc-url>` first
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { type Hex } from "viem";
import { syncPrice, formatSqrtPrice } from "../src/sync-price";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npm run sync-price <pool-address>");
    console.error("\nSyncs a Uniswap V3 pool's price and balances on the fork to match mainnet.");
    console.error("Prerequisites: npm run start:fork <rpc-url>");
    process.exit(1);
  }

  const poolAddress = args[0] as Hex;

  const deploymentPath = join(__dirname, "../.deployment.json");
  if (!existsSync(deploymentPath)) {
    console.error("Error: No deployment found. Run `npm run start:fork` first.");
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));
  const { rpcUrl, forkUrl } = deployment;

  if (!forkUrl) {
    console.error("Error: No fork URL found. Run `npm run start:fork <rpc-url>` first.");
    process.exit(1);
  }

  console.log("=== Uniswap V3 Price Sync ===\n");
  console.log("Pool:", poolAddress);

  const result = await syncPrice({ poolAddress, forkRpc: rpcUrl, mainnetRpc: forkUrl });

  console.log(`Token0: ${result.token0}`);
  console.log(`Token1: ${result.token1}`);
  console.log(`Fee: ${result.fee} (${result.fee / 10000}%)`);
  console.log(
    `\nPrice (t1/t0): ${formatSqrtPrice(result.before.sqrtPriceX96)} → ${formatSqrtPrice(result.after.sqrtPriceX96)}`,
  );
  console.log(`Token0 balance: ${result.before.balance0} → ${result.after.balance0}`);
  console.log(`Token1 balance: ${result.before.balance1} → ${result.after.balance1}`);
  console.log("\nDone!");
}

main().catch(console.error);
