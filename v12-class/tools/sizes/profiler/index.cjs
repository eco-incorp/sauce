// A stand-in `sauce-compiler` that compiles with SAUCE_COMPILER_REAL and times each compile: the
// whole call, and the host callbacks inside it (resolve, resolvePackage, programOptions), with the
// bytes each `resolve` answered. `globalThis.__sauceProfile` collects one entry per compile.
const { join } = require("node:path");
const real = require(join(process.env.SAUCE_COMPILER_REAL, "node/sauce_wasm.js"));
globalThis.__sauceProfile = [];
exports.clearFunctionCache = real.clearFunctionCache;
exports.functionCacheStats = real.functionCacheStats;
exports.compile = function compile(options) {
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
      if (name === "resolve" && result) entry.files[args[0]] = (entry.files[args[0]] ?? 0) + result.length;
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
};
