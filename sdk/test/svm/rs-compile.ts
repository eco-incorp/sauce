/**
 * Shared RS/WASM SauceScript compile helper for SVM venue tests — the venue-side
 * analogue of `sdk/test/std/token/harness.ts`'s loader, generalized so any venue
 * test can compile an Account-model quote program through the PUBLISHED RUST
 * compiler (the `sauce-compiler` dep, i.e. the npm `@eco-incorp/sauce-compiler`
 * wasm package) and read back the SVM account manifest.
 *
 * The venues target the Account model: typed `Account` params on `main(...)`
 * plus `svm.sload(acct, off, w).toLe()` reads, with the manifest reporting the
 * attach order.
 *
 * The migration transform (see sdk/src/svm/venues/pumpswap/index.ts for the pilot):
 *   - a venue's ordered `quoteAccounts(cfg)` become the ordered `Account` params
 *     of `main(...)`, named positionally `acc0, acc1, ...` (param index == the
 *     account's index in `quoteAccounts()`);
 *   - each `accountUint("<ref>", off, w)` in the emitted fragment becomes
 *     `svm.sload(acc<k>, off, w).toLe()`, where k is that ref's `quoteAccounts()`
 *     index (`accountUint` lowers to CAST_LE, so `.toLe()` is the exact match);
 *   - the emitted `manifest.accounts` slots come back in that same param order,
 *     so `manifest.accounts[k]` binds to `quoteAccounts(cfg)[k].address`.
 */
import { createRequire } from 'node:module';

/**
 * The role a slot account requires of the caller — the `requires` field the RS compiler emits on
 * every slot entry as of sauce#main's entry-account-role work (ECO-2150). A bare `Account` param
 * (every venue quote account: read via `svm.sload`, never written) is `readonly`.
 */
export type SvmAccountRole = 'readonly' | 'writable' | 'readonly_signer' | 'writable_signer';

/** One entry of the SVM attach manifest — `{"kind":"slot",…}` / `{"kind":"program",…}` over the wire. */
export type SvmManifestAccount =
  | { kind: 'slot'; index: number; name: string; requires: SvmAccountRole }
  | { kind: 'program'; pubkey: `0x${string}` };

/** The SVM account manifest: what the SDK must attach, in order. `undefined` on the EVM. */
export interface SvmManifest {
  accounts: SvmManifestAccount[];
}

export interface SvmArtifact {
  bytecode: Uint8Array;
  manifest?: SvmManifest;
}

interface WasmCompileOptions {
  target: 'evm' | 'svm';
  entry: string;
  resolve: (path: string) => Uint8Array;
}

// The SauceScript compiler: the published `@eco-incorp/sauce-compiler`, imported under the short
// name `sauce-compiler` because the in-repo workspace package still holds the scoped
// name (`@eco-incorp/sauce-compiler`) when the alias was introduced. Required via `createRequire` for the same reason
// `test/std/token/harness.ts` and `test/helpers.ts` do: the package's `node` condition is a
// CommonJS build that reads its sibling `.wasm` off disk at load, and jest's ESM transform does not
// resolve that sibling.
const { compile } = createRequire(import.meta.url)('sauce-compiler') as {
  compile: (options: WasmCompileOptions) => SvmArtifact;
};

const ENTRY = 'main.js';

/**
 * Compile a whole SauceScript `main(...)` program for the SVM target through the RS compiler,
 * returning its bytecode and account manifest. The source has no package imports (a venue quote
 * program reads accounts via `svm.sload` over its own `Account` params), so the resolver only ever
 * serves the entry module.
 */
export function compileSvm(source: string): SvmArtifact {
  const resolve = (path: string): Uint8Array => {
    const key = path.startsWith('./') ? path.slice(2) : path;
    if (key === ENTRY) return Buffer.from(source);
    throw new Error(`no such module: ${path}`);
  };
  return compile({ target: 'svm', entry: ENTRY, resolve });
}

/**
 * Wrap a venue quote FRAGMENT (statement body referencing `acc0, acc1, …`) into a compilable
 * Account-model `main(...)`. `accountCount` is `quoteAccounts(cfg).length`; params are named
 * positionally `acc0..acc<n-1>` (matching the fragment and the `quoteAccounts()` order), so the
 * emitted `manifest.accounts` slots come back in that exact order. `returnExpr` is the fragment's
 * result expression (e.g. `q0`).
 */
export function wrapQuoteMain(accountCount: number, fragment: string, returnExpr: string): string {
  const params = Array.from({ length: accountCount }, (_, k) => `acc${k}: Account`).join(', ');
  return `function main(${params}): Uint256 {\n${fragment}\n  return ${returnExpr};\n}`;
}
