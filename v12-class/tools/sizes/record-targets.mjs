// Records the compiles of the programs v12-557r targets, through tools/sizes/logger (LOG_DIR per case):
//   cd tools/sizes && SAUCE_COMPILER_PKG=./logger SAUCE_COMPILER_REAL=<pkg> \
//     node --import ./register.mjs record-targets.mjs <sdk-tree> <out dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [tree, out] = process.argv.slice(2);
const { compileSauceProgram } = await import(pathToFileURL(join(tree, "sdk/dist/routes/index.js")).href);
const options = { intents: { executionFee: 1000n, deadline: 2000000000n, openedAt: 1900000000n, salt: `0x${"5a".repeat(32)}` } };
const trivial = "function main(): Uint256 { return 1; }";
const file = (path) => readFileSync(join(tree, path), "utf8");
const cases = [
  ["trivial@base", "base", trivial],
  ["trivial@ethereum", "ethereum", trivial],
  ["trivial@solana", "solana", trivial],
  ["cross-chain@base", "base", file("skills/sauce-intents/examples/cross-chain.sauce.ts")],
  ["cross-chain@ethereum", "ethereum", file("skills/sauce-intents/examples/cross-chain.sauce.ts")],
  ["swap-on-base@ethereum", "ethereum", file("skills/sauce-intents/examples/swap-on-base.sauce.ts")],
  ["distributed-swap@base", "base", file("skills/sauce-distributed-swap/examples/distributed-swap.sauce.ts")],
];
for (const [name, chain, text] of cases) {
  process.env.LOG_DIR = join(out, name);
  const program = compileSauceProgram(chain, text, options);
  console.log(name.padEnd(24), program.bytecode.length, "bytes", (program.bodies ?? []).length, "bodies");
}
