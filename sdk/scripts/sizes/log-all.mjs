// Every example and recipe program's compile inputs, one directory per program and chain:
//   SAUCE_COMPILER_PKG=./logger SAUCE_COMPILER_REAL=<v12>/compiler/crates/sauce-wasm/pkg \
//     node --import ./register.mjs log-all.mjs <sdk-tree> <out dir>
// Replay them on any builds with replay-all.mjs.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
const [rootArg, out] = process.argv.slice(2);
const root = resolvePath(rootArg);
const { compileSauceProgram } = await import(
  pathToFileURL(join(root, "sdk/dist/routes/index.js")).href
);
const dirs = [
  join(root, "docs/examples"),
  ...readdirSync(join(root, "skills")).map((s) => join(root, "skills", s, "examples")),
  join(root, "sdk/src/recipes"),
];
const files = dirs.filter(existsSync).flatMap((d) =>
  readdirSync(d)
    .filter((n) => n.endsWith(".sauce.ts"))
    .map((n) => join(d, n)),
);
let i = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const resolve = (p) => {
    const at = resolvePath(dirname(file), p);
    return existsSync(at) ? new TextEncoder().encode(readFileSync(at, "utf8")) : undefined;
  };
  for (const chain of ["base", "ethereum", "solana"]) {
    const dir = join(out, `${file.slice(root.length + 1).replaceAll("/", "__")}@${chain}`);
    process.env.LOG_DIR = dir;
    try {
      compileSauceProgram(chain, text, { resolve });
      i++;
    } catch {}
  }
}
console.log(i);
