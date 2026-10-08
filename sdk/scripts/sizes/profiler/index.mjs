// A stand-in `sauce-compiler` that compiles with SAUCE_COMPILER_REAL and times each compile: the
// whole call, and the host callbacks inside it (resolve, resolvePackage, programOptions), with the
// bytes each `resolve` answered. `globalThis.__sauceProfile` collects one entry per compile.
import { createRequire } from "node:module";
import { join } from "node:path";

// The real build's CommonJS glue, which loads its wasm as it is required.
const real = createRequire(import.meta.url)(
  join(process.env.SAUCE_COMPILER_REAL, "node/sauce_wasm.js"),
);
globalThis.__sauceProfile = [];
export const clearFunctionCache = real.clearFunctionCache;
export const functionCacheStats = real.functionCacheStats;
export function compile(options) {
  const entry = { entry: options.entry, kind: options.entryKind, ms: 0, callbacks: {}, files: {} };
  const timed = (name, fn) =>
    fn &&
    ((...args) => {
      const t = performance.now();
      const result = fn(...args);
      const spent = performance.now() - t;
      const c = (entry.callbacks[name] ??= { n: 0, ms: 0 });
      c.n++;
      c.ms += spent;
      if (name === "resolve" && result)
        entry.files[args[0]] = (entry.files[args[0]] ?? 0) + result.length;
      return result;
    });
  const wrapped = {
    ...options,
    resolve: timed("resolve", options.resolve),
    resolvePackage: timed("resolvePackage", options.resolvePackage),
    programOptions: timed("programOptions", options.programOptions),
  };
  for (const k of Object.keys(wrapped)) if (wrapped[k] === undefined) delete wrapped[k];
  globalThis.__sauceProfile.push(entry);
  const t = performance.now();
  try {
    return real.compile(wrapped);
  } finally {
    entry.ms = performance.now() - t;
  }
}
