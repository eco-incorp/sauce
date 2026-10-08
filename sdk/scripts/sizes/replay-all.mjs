// Each program log-all.mjs logged, compiled on each build in one process, the builds interleaved so
// machine load falls on all of them alike: the median of 5 cold (function cache cleared) and warm
// compiles, in ms, as JSON {program: {build: [cold, warm]}}. A build that cannot compile a program
// is left out of its entry.
//   node replay-all.mjs <logs dir> 2.5.0=<pkg> new=<v12>/compiler/crates/sauce-wasm/pkg ...
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const [logs, ...pairs] = process.argv.slice(2);
const builds = pairs.map((p) => {
  const [name, dir] = p.split("=");
  return [name, require(`${dir}/node/sauce_wasm.js`)];
});
const enc = new TextEncoder();
const out = {};
for (const program of fs.readdirSync(logs).sort()) {
  if (!fs.statSync(path.join(logs, program)).isDirectory()) continue;
  const calls = fs
    .readdirSync(path.join(logs, program))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(logs, program, f), "utf8")));
  if (calls.length === 0) continue;
  const runs = calls.map((log) => {
    const resolve = (p) => {
      const s = log.files[p] ?? (log.basename ? log.files[p.split("/").pop()] : undefined);
      return s === undefined ? undefined : enc.encode(s);
    };
    const resolvePackage = (s, i) => log.packages[`${s}\u0000${i}`];
    const answers = new Map(log.asked.map((a) => [JSON.stringify(a.scope), a.answer]));
    const programOptions = log.asked.length
      ? (scope) =>
          answers.get(
            JSON.stringify(scope, (k, v) => (typeof v === "bigint" ? v.toString() : v)),
          ) ?? log.asked[0].answer
      : undefined;
    return (compile) => compile({ ...log.options, resolve, resolvePackage, programOptions });
  });
  const samples = Object.fromEntries(
    builds.map(([name]) => [name, { cold: [], warm: [], ok: true }]),
  );
  for (const [name, b] of builds) {
    try {
      runs.forEach((r) => r(b.compile));
    } catch {
      samples[name].ok = false;
    }
  }
  for (let i = 0; i < 5; i++) {
    for (const [name, b] of builds) {
      if (!samples[name].ok) continue;
      b.clearFunctionCache();
      let t = performance.now();
      runs.forEach((r) => r(b.compile));
      samples[name].cold.push(performance.now() - t);
      t = performance.now();
      runs.forEach((r) => r(b.compile));
      samples[name].warm.push(performance.now() - t);
    }
  }
  const med = (x) => Math.round(x.sort((a, c) => a - c)[Math.floor(x.length / 2)] * 10) / 10;
  out[program] = Object.fromEntries(
    Object.entries(samples)
      .filter(([, s]) => s.ok)
      .map(([n, s]) => [n, [med(s.cold), med(s.warm)]]),
  );
}
console.log(JSON.stringify(out));
