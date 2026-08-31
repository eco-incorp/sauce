/**
 * CLI entry point for SauceScript runner
 *
 * Usage: npm run sauce <path-to-file.js> [NAME=VALUE] [NAME=VALUE] ...
 *
 * Prerequisites: Run `npm run start:local` first to start Anvil and deploy Sauce
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { executeScript, parseDefine } from "../src/runner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npm run sauce <path-to-file.js> [NAME=VALUE] ...");
    console.error("Example: npm run sauce sauce/js/add.js ARG_A=5 ARG_B=10");
    process.exit(1);
  }

  const scriptPath = resolve(args[0]);
  const defines = Object.fromEntries(args.slice(1).map(parseDefine));

  if (!existsSync(scriptPath)) {
    console.error(`Error: File not found: ${scriptPath}`);
    process.exit(1);
  }

  const repoRoot = join(__dirname, "..");

  // Check if deployment exists
  const deploymentPath = join(repoRoot, ".deployment.json");
  if (!existsSync(deploymentPath)) {
    console.error(
      "Error: No deployment found. Run `npm run start:local` first.",
    );
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));
  const { sauceAddress, rpcUrl, forkUrl } = deployment;

  await executeScript({
    scriptPath,
    defines,
    sauceAddress,
    rpcUrl,
    forkUrl,
    baseDir: repoRoot,
  });
}

main().catch(console.error);
