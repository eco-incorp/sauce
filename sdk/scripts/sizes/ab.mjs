// Two SDK trees, one process, compiles interleaved so machine load falls on both alike: the median
// of `repeats` cold (compiler's function cache cleared) and warm compiles of each program, in ms.
//   node ab.mjs <tree-a> <tree-b> [repeats]  (both trees link the same compiler)
import { readFileSync } from "node:fs";
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
const options = {
  intents: {
    executionFee: 1000n,
    deadline: 2000000000n,
    openedAt: 1900000000n,
    salt: `0x${"5a".repeat(32)}`,
  },
};
const trivial = "function main(): Uint256 { return 1; }";
const file = (path) => readFileSync(join(b, path), "utf8");
const cases = [
  ["trivial@base", "base", trivial],
  ["trivial@ethereum", "ethereum", trivial],
  ["trivial@solana", "solana", trivial],
  ["cross-chain@base", "base", file("skills/sauce-intents/examples/cross-chain.sauce.ts")],
  ["cross-chain@ethereum", "ethereum", file("skills/sauce-intents/examples/cross-chain.sauce.ts")],
  [
    "swap-on-base@ethereum",
    "ethereum",
    file("skills/sauce-intents/examples/swap-on-base.sauce.ts"),
  ],
  ["router-route@ethereum", "ethereum", file("docs/examples/router-route.sauce.ts")],
  [
    "distributed-swap@base",
    "base",
    file("skills/sauce-distributed-swap/examples/distributed-swap.sauce.ts"),
  ],
];
const median = (xs) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const rows = [];
for (const [name, chain, text] of cases) {
  const samples = trees.map(() => ({ cold: [], warm: [] }));
  for (const [, compile] of trees) compile(chain, text, options);
  for (let i = 0; i < Number(repeats); i++) {
    trees.forEach(([, compile], t) => {
      clearFunctionCache();
      let s = performance.now();
      compile(chain, text, options);
      samples[t].cold.push(performance.now() - s);
      s = performance.now();
      compile(chain, text, options);
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
