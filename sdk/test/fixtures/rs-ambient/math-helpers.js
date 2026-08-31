// P6 fixture: an ordinary SauceScript module with no relationship to `ambient` by itself -- it
// becomes an AMBIENT module only when a caller passes `ambient: ["./math-helpers.js"]` to the
// RS/WASM compiler (`rs-compile.ts`). Exists purely so `routes-compiler-selector.test.ts` can
// prove a program using `double`/`BOOST` with NO `import` line compiles through
// `compiler: 'rs'` + `options.ambient`, and fails everywhere else (plain `compiler: 'rs'` with no
// `ambient`, and the default `compiler: 'ts'`, which has no `ambient` concept at all).
export const BOOST = 2n;

export function double(x) {
  return x * BOOST;
}
