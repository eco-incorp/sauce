// Records the compiles of four programs that cover a chain's module — the trivial program on
// three chains and the distributed swap — through
// ./logger (LOG_DIR per case), for replay-all.mjs to time on any compiler build:
//   SAUCE_COMPILER_PKG=./logger SAUCE_COMPILER_REAL=<pkg> \
//     node --import ./register.mjs record-targets.mjs <sdk-tree> <out dir>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [tree, out] = process.argv.slice(2);
const { compileSauceProgram } = await import(
  pathToFileURL(join(tree, "sdk/dist/routes/index.js")).href
);
const trivial = "function main(): Uint256 { return 1; }";
// A program the tree does not have is left out.
const file = (path) =>
  existsSync(join(tree, path)) ? readFileSync(join(tree, path), "utf8") : undefined;
const cases = [
  ["trivial@base", "base", trivial],
  ["trivial@ethereum", "ethereum", trivial],
  ["trivial@solana", "solana", trivial],
  [
    "distributed-swap@base",
    "base",
    file("skills/sauce-distributed-swap/examples/distributed-swap.sauce.ts"),
  ],
].filter(([, , text]) => text !== undefined);
for (const [name, chain, text] of cases) {
  process.env.LOG_DIR = join(out, name);
  const program = compileSauceProgram(chain, text);
  console.log(
    name.padEnd(24),
    program.bytecode.length,
    "bytes",
    (program.bodies ?? []).length,
    "bodies",
  );
}
