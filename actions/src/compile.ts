/**
 * This package's one compiler seam — the SDK's own (`sdk/src/wasm-compiler.ts`), so an actions
 * compile shares the SDK's wasm instance and its `ready()`: in a browser, `await ready()` from
 * `@eco-incorp/sauce` or `@eco-incorp/sauce/compiler` once, and every compile here works.
 *
 * A generated program's ABI bindings are handed to the compiler in memory as `inlineContracts`. The
 * one module it may import is `@sauce/router`, for a swap at one of that library's venues, and the
 * SDK serves it — and the `@sauce/token` and pool ABIs it imports in turn — from memory
 * (`resolveSdkPackage`, `resolveSdkModule`), so no caller resolver and no filesystem is involved.
 */
import type { CompileResult } from "sauce-compiler";

// By relative path into the SDK's build, like `registry.ts`: in the published tarball `actions/dist`
// and `sdk/dist` are siblings.
import { compile } from "../../sdk/dist/wasm-compiler.js";
import type { ActionContracts } from "./abis.js";
import { resolveSdkModule, resolveSdkPackage } from "./registry.js";

const ENTRY = "main.js";

/** Compiles a generated SauceScript program, and the ABI bindings it names, for the EVM. */
export function compileEvm(source: string, contracts: ActionContracts = {}): CompileResult {
  const bytes = new TextEncoder().encode(source);
  const inlineContracts = Object.entries(contracts).map(
    ([name, { abi }]) => [name, JSON.stringify(abi)] as [string, string],
  );

  return compile({
    target: "evm",
    entry: ENTRY,
    resolve: (path) => (path === ENTRY ? bytes : resolveSdkModule(path)),
    resolvePackage: (specifier) => resolveSdkPackage(specifier),
    inlineContracts: inlineContracts.length > 0 ? inlineContracts : undefined,
  });
}
