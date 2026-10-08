// Compiles a recording (recorder/index.cjs) on one or more compiler builds, with no SDK:
//   node replay.mjs <recording.json> <pkg> [<pkg> …]
// Each option function answers from what it returned while recording (and declines anything else).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const [file, ...pkgs] = process.argv.slice(2);
const recording = JSON.parse(readFileSync(file, "utf8"), (_, v) =>
  v && typeof v === "object" && "$bigint" in v ? BigInt(v.$bigint) : v && typeof v === "object" && "$text" in v ? new TextEncoder().encode(v.$text) : v,
);
const options = { ...recording.options, cache: false };
for (const [key, calls] of Object.entries(recording.calls)) {
  const answers = new Map(calls.map(({ args, result }) => [JSON.stringify(args), result]));
  options[key] = (...args) => answers.get(JSON.stringify(args)) ?? undefined;
}
for (const pkg of pkgs) {
  const { compile } = require(join(pkg, "node/sauce_wasm.js"));
  try {
    console.log(`${pkg.split("/").slice(-1)[0].padEnd(28)} ${compile(options).bytecode.length} (recorded ${recording.bytes})`);
  } catch (e) {
    console.log(`${pkg.split("/").slice(-1)[0].padEnd(28)} ERR ${String(e.message).replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => /╰─▶|error/.test(l)).slice(-1)[0]}`);
  }
}
