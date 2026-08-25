/**
 * Shared RS/WASM SauceScript compile helper for SVM venue tests — the venue-side
 * analogue of `sdk/test/std/token/harness.ts`'s loader, generalized so any venue
 * test can compile an Account-model quote program through the PUBLISHED RUST
 * compiler (`@eco-incorp/sauce-compiler-wasm`, built into `sdk/.sauce-wasm/` by
 * scripts/build-wasm.mjs) and read back the SVM account manifest.
 *
 * This is the compiler the migrated venues target: the Account model — typed
 * `Account` params on `main(...)` plus `svm.sload(acct, off, w).toLe()` reads —
 * exists only in the RS compiler, not the in-repo TypeScript one (which uses the
 * older `accountUint("<ref>", off, w)` string-ref sugar + `accountPlan.metas`).
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
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// The Rust compiler is built FROM the `sauce-next` dep into `sdk/.sauce-wasm/` by scripts/build-wasm.mjs
// (the sdk `pretest` runs it). It is REQUIRED — the RS compiler is the SDK's SVM compiler going forward —
// so a missing build is a HARD ERROR, not a skip. `--target nodejs` output is CommonJS plus a sibling
// `.wasm` read through `fs`, so `createRequire` hands it to Node's own CJS loader (the only one that
// resolves the `.wasm` sibling), not jest's ESM transform.
const WASM_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.sauce-wasm', 'sauce_wasm.js');
if (!existsSync(WASM_ENTRY)) {
  throw new Error(
    `Rust SauceScript compiler not built at ${WASM_ENTRY}. Run \`pnpm --filter ./sdk build:wasm\` ` +
      '(needs Rust + wasm-pack); the sdk `pretest` runs it automatically.',
  );
}
const { compile } = createRequire(import.meta.url)(WASM_ENTRY) as {
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
