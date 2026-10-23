// A stand-in `sauce-compiler` that compiles with the build in SAUCE_COMPILER_REAL (a built
// crates/sauce-wasm/pkg) and writes each compile's inputs to LOG_DIR as 0.json, 1.json, …: the
// options, every file `resolve` answered, every `resolvePackage` answer, and every `programOptions`
// scope with its answer, so a compile replays with exactly the options it was given.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// The real build's CommonJS glue, which loads its wasm as it is required.
const real = createRequire(import.meta.url)(
  path.join(process.env.SAUCE_COMPILER_REAL, "node/sauce_wasm.js"),
);
let n = 0;
const plain = (_, v) =>
  typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v;
export const clearFunctionCache = real.clearFunctionCache;
export const functionCacheStats = real.functionCacheStats;
export function compile(options) {
  const files = {};
  const packages = {};
  const asked = [];
  const resolve = (p) => {
    const r = options.resolve(p);
    if (r !== undefined && r !== null) files[p] = new TextDecoder().decode(r);
    return r;
  };
  const resolvePackage =
    options.resolvePackage &&
    ((specifier, importer) => {
      const r = options.resolvePackage(specifier, importer);
      packages[`${specifier}\u0000${importer}`] = r;
      return r;
    });
  const programOptions =
    options.programOptions &&
    ((scope) => {
      const answer = options.programOptions(scope);
      asked.push({ scope, answer });
      return answer;
    });
  const result = real.compile({ ...options, resolve, resolvePackage, programOptions });
  const dir = process.env.LOG_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    const recorded = {
      ...options,
      resolve: undefined,
      resolvePackage: undefined,
      programOptions: undefined,
    };
    fs.writeFileSync(
      path.join(dir, `${n++}.json`),
      JSON.stringify({ options: recorded, files, packages, asked }, plain),
    );
  }
  return result;
}
