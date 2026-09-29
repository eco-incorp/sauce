/**
 * This package's one compiler seam — the SDK's own (`sdk/src/wasm-compiler.ts`), so an actions
 * compile shares the SDK's wasm instance and its `ready()`: in a browser, `await ready()` from
 * `@eco-incorp/sauce` or `@eco-incorp/sauce/compiler` once, and every compile here works.
 *
 * A generated program imports no module: its ABI bindings are handed to the compiler in memory as
 * `inlineContracts`, so the resolver only ever serves the entry — no caller modules, no
 * `resolvePackage`. That is why this is not the SDK's `routes/rs-compile.ts`, which also resolves
 * the SDK's own stdlib and a caller's files.
 */
import type { CompileResult } from "sauce-compiler";

// By relative path into the SDK's build, like `registry.ts`: in the published tarball `actions/dist`
// and `sdk/dist` are siblings.
import { compile } from "../../sdk/dist/wasm-compiler.js";
import type { ActionContracts } from "./abis.js";

const ENTRY = "main.js";

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
  const bytes = new TextEncoder().encode(source);
  const inlineContracts = Object.entries(contracts).map(
    ([name, { abi }]) => [name, JSON.stringify(abi)] as [string, string],
  );

  return compile({
    target: "evm",
    entry: ENTRY,
    resolve: (path) => (path === ENTRY ? bytes : undefined),
    inlineContracts: inlineContracts.length > 0 ? inlineContracts : undefined,
    compactArgs: options.compactArgs,
  });
}
