// Records the compiles one SDK program makes (recorder/index.cjs), under textual edits:
//   SAUCE_COMPILER_PKG=recorder REAL_SAUCE_COMPILER=<pkg> SAUCE_RECORD_DIR=<dir> \
//     node --import ./register.mjs record.mjs <sdk-tree> <chain> <file> '[[from, to], …]'
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [tree, chain, file, editsJson = "[]"] = process.argv.slice(2);
const { compileSauceProgram } = await import(pathToFileURL(join(tree, "sdk/dist/routes/index.js")).href);
let text = readFileSync(join(tree, file), "utf8");
for (const [from, to] of JSON.parse(editsJson)) {
  if (!text.includes(from)) throw new Error(`no "${from}"`);
  text = text.split(from).join(to);
}
const options = { intents: { executionFee: 1000n, deadline: 2000000000n, openedAt: 1900000000n, salt: `0x${"5a".repeat(32)}` } };
console.log(compileSauceProgram(chain, text, options).bytecode.length);
