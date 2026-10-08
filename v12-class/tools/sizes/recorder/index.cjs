// A stand-in for `sauce-compiler` that records every compile's inputs, then compiles with the real
// build REAL_SAUCE_COMPILER names. Each compile is written to SAUCE_RECORD_DIR/<n>.json: the options
// that are values, and every call the compiler made to an option that is a function (`resolve`,
// `resolvePackage`, …) with what it returned. `replay.mjs` compiles a recording on any build.
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const real = require(join(process.env.REAL_SAUCE_COMPILER, "node/sauce_wasm.js"));

const encode = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) =>
      typeof v === "bigint"
        ? { $bigint: v.toString() }
        : v instanceof Uint8Array
          ? { $text: Buffer.from(v).toString("utf8") }
          : v,
    ),
  );

let count = 0;
exports.clearFunctionCache = real.clearFunctionCache;
exports.functionCacheStats = real.functionCacheStats;
exports.compile = function compile(options) {
  const values = {};
  const calls = {};
  const wrapped = {};
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "function") {
      calls[key] = [];
      wrapped[key] = (...args) => {
        const result = value(...args);
        calls[key].push({ args, result: result ?? null });
        return result;
      };
    } else {
      values[key] = value;
      wrapped[key] = value;
    }
  }
  let result;
  let error;
  try {
    result = real.compile(wrapped);
  } catch (e) {
    error = e;
  }
  const dir = process.env.SAUCE_RECORD_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${String(count++).padStart(2, "0")}.json`),
      JSON.stringify(
        encode({ options: values, calls, bytes: result?.bytecode.length ?? null, error: error?.message ?? null }),
        null,
        1,
      ),
    );
  }
  if (error) throw error;
  return result;
};
