// Where one SDK compile spends its time: SAUCE_COMPILER_PKG=./profiler SAUCE_COMPILER_REAL=<pkg> \
//   node --import ./register.mjs profile.mjs <sdk-tree> <chain> <file | -e source> [repeats]
// Prints, for the median warm and cold run: the SDK's own time (outside every compile call), each
// compile call's time, the host callbacks inside it, and the largest files `resolve` answered.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { clearFunctionCache } from "sauce-compiler";
const [tree, chain, fileOrFlag, sourceOrRepeats, maybeRepeats] = process.argv.slice(2);
const inline = fileOrFlag === "-e";
const text = inline ? sourceOrRepeats : readFileSync(join(tree, fileOrFlag), "utf8");
const repeats = Number((inline ? maybeRepeats : sourceOrRepeats) ?? 7);
const { compileSauceProgram } = await import(
  pathToFileURL(join(tree, "sdk/dist/routes/index.js")).href
);
const run = (cold) => {
  if (cold) clearFunctionCache();
  globalThis.__sauceProfile.length = 0;
  const t = performance.now();
  compileSauceProgram(chain, text);
  const total = performance.now() - t;
  const calls = globalThis.__sauceProfile.map((e) => ({ ...e }));
  return { total, calls };
};
run(true);
const summary = (runs) => {
  runs.sort((a, b) => a.total - b.total);
  const r = runs[Math.floor(runs.length / 2)];
  const inCompile = r.calls.reduce((s, c) => s + c.ms, 0);
  const cb = {};
  for (const c of r.calls)
    for (const [k, v] of Object.entries(c.callbacks)) {
      cb[k] ??= { n: 0, ms: 0 };
      cb[k].n += v.n;
      cb[k].ms += v.ms;
    }
  const cbMs = Object.values(cb).reduce((s, v) => s + v.ms, 0);
  const files = {};
  for (const c of r.calls)
    for (const [k, v] of Object.entries(c.files)) files[k] = Math.max(files[k] ?? 0, v);
  const big = Object.entries(files)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k.split("/").slice(-2).join("/")} ${Math.round(v / 1024)}K`);
  return {
    total: +r.total.toFixed(1),
    sdkOutside: +(r.total - inCompile).toFixed(1),
    compileCalls: r.calls.length,
    insideCompile: +inCompile.toFixed(1),
    callbacks: Object.fromEntries(
      Object.entries(cb).map(([k, v]) => [k, `${v.n}× ${v.ms.toFixed(1)}ms`]),
    ),
    compilerOwn: +(inCompile - cbMs).toFixed(1),
    resolvedKB: Math.round(Object.values(files).reduce((s, v) => s + v, 0) / 1024),
    biggest: big,
  };
};
const cold = [],
  warm = [];
for (let i = 0; i < repeats; i++) {
  cold.push(run(true));
  warm.push(run(false));
}
console.log(JSON.stringify({ cold: summary(cold), warm: summary(warm) }, null, 1));
