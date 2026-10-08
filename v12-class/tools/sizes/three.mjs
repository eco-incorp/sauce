// One generic program on three compiler builds: node three.mjs '<main.js source>' ['<lib.js source>']
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const builds = {
  "2.5.0": "/Users/er/Documents/Projects/v12-class/sdk-main/node_modules/sauce-compiler/node/sauce_wasm.js",
  "2155102e": "/Users/er/Documents/Projects/v12-class/sauce-compiler-2155/node/sauce_wasm.js",
  "68ddccf5": "/Users/er/Documents/Projects/v12-class/sauce-compiler-68dd/node/sauce_wasm.js",
};
const files = { "main.js": process.argv[2], "lib.js": process.argv[3] ?? "" };
for (const [name, path] of Object.entries(builds)) {
  const c = require(path);
  try {
    const r = c.compile({ cache: false, target: "evm", resolve: (p) => { const k = p.replace(/^\.\//, ""); return files[k] === undefined ? undefined : new TextEncoder().encode(files[k]); } });
    console.log(name.padEnd(9), r.bytecode.length);
  } catch (e) { console.log(name.padEnd(9), "ERR", String(e.message).replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => /╰─▶|error/.test(l)).slice(-1)[0]); }
}
