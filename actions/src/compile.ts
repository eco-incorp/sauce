/**
 * This package's one compiler seam — the published `@eco-incorp/sauce-compiler` wasm package,
 * depended on under the alias `sauce-compiler`.
 *
 * A generated program imports no module: its ABI bindings are handed to the compiler in memory as
 * `inlineContracts`, so the resolver only ever serves the entry — no `baseDirs`, no
 * `resolvePackage`. That is why this is not a copy of `sdk/src/routes/rs-compile.ts`, which also
 * resolves the SDK's own stdlib and a caller's files.
 */

import { createRequire } from "node:module";

import type { CompileOptions, CompileResult } from "sauce-compiler";

import type { ActionContracts } from "./abis.js";

const ENTRY = "main.js";

let compileFn: ((options: CompileOptions) => CompileResult) | undefined;

/** Lazily loads the wasm module — only paid once something actually compiles. */
function load(): (options: CompileOptions) => CompileResult {
  if (compileFn) return compileFn;
  // Required via `createRequire`, not `import`: the package's `node` condition is a CommonJS build
  // that reads its sibling `.wasm` off disk at load, and Node's own CJS loader is the one that
  // resolves that sibling. Mirrors `sdk/src/routes/rs-compile.ts`.
  let mod: { compile: (options: CompileOptions) => CompileResult };
  try {
    mod = createRequire(import.meta.url)("sauce-compiler") as typeof mod;
  } catch (cause) {
    throw new Error(
      "the SauceScript compiler (`sauce-compiler` -> the published @eco-incorp/sauce-compiler) failed to load.",
      { cause },
    );
  }
  compileFn = mod.compile;

  return compileFn;
}

export interface EvmCompileOptions {
  /** Encode `main`'s arguments compact-v1 instead of ABI-v1. */
  readonly compactArgs?: boolean;
}

/** Compiles a generated SauceScript program, and the ABI bindings it names, for the EVM. */
export function compileEvm(
  source: string,
  contracts: ActionContracts = {},
  options: EvmCompileOptions = {},
): CompileResult {
  const bytes = Buffer.from(source, "utf8");
  const inlineContracts = Object.entries(contracts).map(
    ([name, { abi }]) => [name, JSON.stringify(abi)] as [string, string],
  );

  return load()({
    target: "evm",
    entry: ENTRY,
    resolve: (path) => (path === ENTRY ? bytes : undefined),
    inlineContracts: inlineContracts.length > 0 ? inlineContracts : undefined,
    compactArgs: options.compactArgs,
  });
}
