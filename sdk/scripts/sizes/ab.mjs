// Two SDK trees, one process, compiles interleaved so machine load falls on both alike: the median
// of `repeats` cold (compiler's function cache cleared) and warm compiles of each program, in ms.
//   node ab.mjs <tree-a> <tree-b> [repeats]  (both trees link the same compiler)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { clearFunctionCache } from "sauce-compiler";
const [a, b, repeats = "9"] = process.argv.slice(2);
const load = async (tree) =>
  (await import(pathToFileURL(join(tree, "sdk/dist/routes/index.js")).href)).compileSauceProgram;
const trees = [
  [a.split("/").pop(), await load(a)],
  [b.split("/").pop(), await load(b)],
];
const trivial = "function main(): Uint256 { return 1; }";
// A program the tree does not have is left out.
const file = (path) =>
  existsSync(join(b, path)) ? readFileSync(join(b, path), "utf8") : undefined;
const cases = [
  ["trivial@base", "base", trivial],
  ["trivial@ethereum", "ethereum", trivial],
  ["trivial@solana", "solana", trivial],
  ["router-route@ethereum", "ethereum", file("docs/examples/router-route.sauce.ts")],
  [
    "distributed-swap@base",
    "base",
    file("skills/sauce-distributed-swap/examples/distributed-swap.sauce.ts"),
  ],
].filter(([, , text]) => text !== undefined);
const median = (xs) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const rows = [];
for (const [name, chain, text] of cases) {
  const samples = trees.map(() => ({ cold: [], warm: [] }));
  for (const [, compile] of trees) compile(chain, text);
  for (let i = 0; i < Number(repeats); i++) {
    trees.forEach(([, compile], t) => {
      clearFunctionCache();
      let s = performance.now();
      compile(chain, text);
      samples[t].cold.push(performance.now() - s);
      s = performance.now();
      compile(chain, text);
      samples[t].warm.push(performance.now() - s);
    });
  }
  rows.push([
    name,
    ...samples.flatMap((x) => [median(x.cold), median(x.warm)]).map((v) => v.toFixed(1)),
  ]);
}
console.log(["program", `${trees[0][0]} cold`, "warm", `${trees[1][0]} cold`, "warm"].join(" | "));
for (const r of rows) console.log(r.join(" | "));
