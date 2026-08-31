/**
 * This package's one compiler seam — the published `@eco-incorp/sauce-compiler` wasm package,
 * depended on under the alias `sauce-compiler`.
 *
 * The programs these generators emit import nothing (no ABI artifact, no sibling module: every
 * call is a raw `evm.call` over a selector this package computes itself), so the resolver only ever
 * has to serve the entry — no `baseDirs`, no `resolvePackage`, no `contracts`. That is the whole
 * reason this is 30 lines rather than a copy of `sdk/src/routes/rs-compile.ts`.
 */

import { createRequire } from 'node:module';

import type { CompileOptions, CompileResult } from 'sauce-compiler';

const ENTRY = 'main.js';

let compileFn: ((options: CompileOptions) => CompileResult) | undefined;

/** Lazily loads the wasm module — only paid once something actually compiles. */
function load(): (options: CompileOptions) => CompileResult {
  if (compileFn) return compileFn;
  // Required via `createRequire`, not `import`: the package's `node` condition is a CommonJS build
  // that reads its sibling `.wasm` off disk at load, and Node's own CJS loader is the one that
  // resolves that sibling. Mirrors `sdk/src/routes/rs-compile.ts`.
  let mod: { compile: (options: CompileOptions) => CompileResult };
  try {
    mod = createRequire(import.meta.url)('sauce-compiler') as typeof mod;
  } catch (cause) {
    throw new Error(
      'the SauceScript compiler (`sauce-compiler` -> the published @eco-incorp/sauce-compiler) failed to load.',
      { cause },
    );
  }
  compileFn = mod.compile;

  return compileFn;
}

/** Compiles a generated SauceScript program for the EVM. */
export function compileEvm(source: string): Uint8Array {
  const bytes = Buffer.from(source, 'utf8');

  return load()({
    target: 'evm',
    entry: ENTRY,
    resolve: (path) => (path === ENTRY ? bytes : undefined),
  }).bytecode;
}
