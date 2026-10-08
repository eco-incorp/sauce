import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const c = require(process.env.PKG ?? "/Users/er/Documents/Projects/v12-class/sauce-compiler-68dd/node/sauce_wasm.js");
const dir = process.argv[2];
const files = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f))]));
const r = c.compile({ cache: false, target: "evm", resolve: (p) => files[p.replace(/^\.\//, "")] });
console.log(Buffer.from(r.bytecode).toString("hex"));
