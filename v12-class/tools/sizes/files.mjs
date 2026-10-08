// One generic program, as several files, on three compiler builds: node files.mjs <dir>
// (<dir>/main.js is the entry; any other file in <dir> resolves by its relative path).
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const builds = {
  "2.5.0": "/Users/er/Documents/Projects/v12-class/sdk-main/node_modules/sauce-compiler/node/sauce_wasm.js",
  "2155102e": "/Users/er/Documents/Projects/v12-class/sauce-compiler-2155/node/sauce_wasm.js",
  "68ddccf5": "/Users/er/Documents/Projects/v12-class/sauce-compiler-68dd/node/sauce_wasm.js",
  ...(process.env.SAUCE_COMPILER_PKG ? { candidate: join(process.env.SAUCE_COMPILER_PKG, "node/sauce_wasm.js") } : {}),
};
const dir = process.argv[2];
const files = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f))]));
for (const [name, path] of Object.entries(builds)) {
  const c = require(path);
  try {
    const r = c.compile({ cache: false, target: "evm", resolve: (p) => files[p.replace(/^\.\//, "")] });
    console.log(name.padEnd(9), r.bytecode.length);
  } catch (e) { console.log(name.padEnd(9), "ERR", String(e.message).replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => /╰─▶|error/.test(l)).slice(-1)[0]); }
}
