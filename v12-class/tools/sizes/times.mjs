// node --import <tools/sizes/register.mjs> times.mjs <sdk-tree> [repeats]: each example and recipe
// program's compile time through the SDK's compile path, cold (function cache cleared) and warm
// (compiled again), median of `repeats`, in ms, as JSON.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { clearFunctionCache } from "sauce-compiler";

const root = resolvePath(process.argv[2]);
const repeats = Number(process.argv[3] ?? 3);
const { compileSauceProgram } = await import(pathToFileURL(join(root, "sdk/dist/routes/index.js")).href);
const dirs = [
  join(root, "docs/examples"),
  ...readdirSync(join(root, "skills")).map((skill) => join(root, "skills", skill, "examples")),
  join(root, "sdk/src/recipes"),
];
const files = dirs
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith(".sauce.ts")).map((name) => join(dir, name)));
const options = { intents: { executionFee: 1000n, deadline: 2000000000n, openedAt: 1900000000n, salt: `0x${"5a".repeat(32)}` } };
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const out = {};
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const resolve = (path) => { const at = resolvePath(dirname(file), path); return existsSync(at) ? new TextEncoder().encode(readFileSync(at, "utf8")) : undefined; };
  for (const chain of ["base", "ethereum", "solana"]) {
    const compile = () => compileSauceProgram(chain, text, { ...options, resolve });
    try { clearFunctionCache(); compile(); } catch { continue; }
    const cold = [], warm = [];
    for (let i = 0; i < repeats; i++) {
      clearFunctionCache();
      let t = performance.now(); compile(); cold.push(performance.now() - t);
      t = performance.now(); compile(); warm.push(performance.now() - t);
    }
    out[`${file.slice(root.length + 1)}@${chain}`] = [median(cold), median(warm)].map((x) => Math.round(x * 10) / 10);
  }
}
console.log(JSON.stringify(out, null, 1));
