/* tslint:disable */
/* eslint-disable */

/**
 * Compile a SauceScript program to Sauce bytecode.
 *
 * `options` is `{ entry?, target, resolve, resolvePackage?, contracts?, optimize? }`:
 * - `target`: `"evm"` or `"svm"` (required).
 * - `resolve(path) -> Uint8Array`: fetch a module's bytes (required). A Node `Buffer` is a
 *   `Uint8Array`; any other return type is a resolve error. A throw is a resolve error too — and
 *   is how a host signals "absent", which the per-target arm probe relies on.
 * - `resolvePackage(specifier, importer) -> string | undefined`: map a bare specifier to a path
 *   `resolve` accepts (optional). `undefined` means "not mine" and falls back to the identity; a
 *   throw means the package is not installed.
 * - `entry`: the entry module path the resolver serves first (default `"main.js"`).
 * - `contracts`: `[name, path]` pairs declaring project-manifest contracts — the WASM mirror of
 *   the CLI's `sauce.toml` `[contracts]` table. Each `path` resolves like an inline
 *   `import Name from "./path.json"` (optional).
 * - `optimize`: apply constant folding (default `true`).
 *
 * Returns `{ bytecode: Uint8Array, manifest: object | undefined }` — `manifest` is the SVM account
 * manifest, `undefined` on the EVM. A compile or resolve failure throws a JS `Error` carrying the
 * same rustc-style diagnostic the CLI prints, never a WASM trap.
 */
export function compile(options: any): any;
