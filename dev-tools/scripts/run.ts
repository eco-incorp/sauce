/**
 * CLI entry point for SauceScript runner
 *
 * Usage: npm run sauce <path-to-file.js> [VALUE ...] [NAME=VALUE ...]
 *
 * A `NAME=VALUE` operand is a compile-time define; a bare value is a positional RUNTIME arg for
 * `main`'s next parameter. The two are told apart by shape — a define's name is an identifier, and
 * no integer or hex literal can look like one — so they may be interleaved freely, and the
 * positional args keep the order they were given in.
 *
 * Prerequisites: Run `npm run start:local` first to start Anvil and deploy Sauce
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { executeScript, parseArg, parseDefine } from "../src/runner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFINE = /^[A-Za-z_$][A-Za-z0-9_$]*=/;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npm run sauce <path-to-file.js> [VALUE ...] [NAME=VALUE ...]");
    console.error("Example: npm run sauce sauce/js/add.js 5 10");
    console.error("Example: npm run sauce test/fixtures/defined.js AMOUNT=4242");
    process.exit(1);
  }

  const scriptPath = resolve(args[0]);
  const operands = args.slice(1);
  const defines = Object.fromEntries(operands.filter((o) => DEFINE.test(o)).map(parseDefine));
  const scriptArgs = operands.filter((o) => !DEFINE.test(o)).map(parseArg);

  if (!existsSync(scriptPath)) {
    console.error(`Error: File not found: ${scriptPath}`);
    process.exit(1);
  }

  const repoRoot = join(__dirname, "..");

  // Check if deployment exists
  const deploymentPath = join(repoRoot, ".deployment.json");
  if (!existsSync(deploymentPath)) {
    console.error("Error: No deployment found. Run `npm run start:local` first.");
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));
  const { sauceAddress, rpcUrl, forkUrl } = deployment;

  await executeScript({
    scriptPath,
    defines,
    args: scriptArgs,
    sauceAddress,
    rpcUrl,
    forkUrl,
    baseDir: repoRoot,
  });
}

main().catch(console.error);
