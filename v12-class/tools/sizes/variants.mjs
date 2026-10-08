// One SDK program on two trees, under textual variants: node variants.mjs <file> <chain> '<json [[from,to],...] per variant>'
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [file, chain, variantsJson] = process.argv.slice(2);
const trees = ["/Users/er/Documents/Projects/v12-class/sdk-main", "/Users/er/Documents/Projects/v12-class/sdk"];
const options = { intents: { executionFee: 1000n, deadline: 2000000000n, openedAt: 1900000000n, salt: `0x${"5a".repeat(32)}` } };
const source = readFileSync(join(trees[1], file), "utf8");
const variants = [["as is", []], ...JSON.parse(variantsJson)];
const compilers = [];
for (const tree of trees) compilers.push((await import(pathToFileURL(join(tree, "sdk/dist/routes/index.js")).href)).compileSauceProgram);
for (const [name, edits] of variants) {
  let text = source;
  for (const [from, to] of edits) {
    if (!text.includes(from)) { console.log(`${name}: no "${from}"`); }
    text = text.split(from).join(to);
  }
  const sizes = compilers.map((compile) => {
    try { return compile(chain, text, options).bytecode.length; }
    catch (e) { return "ERR " + String(e.message).replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => /╰─▶|error/.test(l)).slice(-1)[0]; }
  });
  console.log(`${name.padEnd(40)} main ${sizes[0]}  rewrite ${sizes[1]}  ${typeof sizes[0] === "number" && typeof sizes[1] === "number" ? sizes[1] - sizes[0] : ""}`);
}
