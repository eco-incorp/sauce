/**
 * `@sauce/token` (sdk/src/std/token) compiled through the PUBLISHED RUST compiler —
 * `@eco-incorp/sauce-compiler-wasm`, NOT the in-repo TypeScript one every other suite here uses.
 * That is the whole point: the library ships as SauceScript source, so the only thing that proves it
 * is the compiler that will actually consume it downstream.
 *
 * The library's four files are byte-identical copies of the sauce repo's conformance fixture
 * (`compiler/crates/sauce-cli/tests/fixtures/sauce-token/`), so a drift between the two repos shows
 * up as a diff rather than as silently divergent behavior. The resolver below reproduces what a Node
 * host's `node_modules` walk hands the compiler: a bare `@sauce/token` mapped to the package entry
 * (`resolvePackage`), the package's own relative `./erc20.abi.json` served from the same directory,
 * and a MISS reported as a throw — the "arm absent" signal the compiler's per-target arm probe
 * (`token.js` → `token.evm.js` / `token.svm.js`) relies on.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Target = 'evm' | 'svm';

/** The role a slot account requires of the caller — the `requires` field the RS compiler emits on
 *  every slot entry as of ECO-2150 (sauce#main's entry-account-role work, now on the converged
 *  compiler). A bare `Account` param is `readonly`. */
export type SvmAccountRole = 'readonly' | 'writable' | 'readonly_signer' | 'writable_signer';

/** One entry of the SVM attach contract — `{"kind":"slot",…}` / `{"kind":"program",…}` over the wire. */
export type AccountEntry =
  | { kind: 'slot'; index: number; name: string; requires: SvmAccountRole }
  | { kind: 'program'; pubkey: `0x${string}` };

/** The SVM account manifest: what the SDK must attach, in order. `undefined` on the EVM. */
export interface Manifest {
  accounts: AccountEntry[];
}

export interface Artifact {
  bytecode: Uint8Array;
  manifest?: Manifest;
}

export interface WasmCompileOptions {
  target: Target;
  entry?: string;
  resolve: (path: string) => Uint8Array;
  resolvePackage?: (specifier: string, importer: string) => string | undefined;
}

// The Rust SauceScript compiler is built FROM the `sauce-next` dep (github:eco-incorp/sauce#main)
// into `sdk/.sauce-wasm/` by scripts/build-wasm.mjs — the sdk `pretest` runs it, so it is present
// whenever the suite runs. It is REQUIRED (the Rust compiler is the SDK's compiler going forward),
// so a missing build is a HARD ERROR, not a skip. wasm-pack's `--target nodejs` output is CommonJS
// plus a sibling `.wasm` it reads through `fs` at load, so `createRequire` hands it to Node's own CJS
// loader — the only one that resolves the `.wasm` sibling — rather than jest's ESM transform.
const WASM_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.sauce-wasm', 'sauce_wasm.js');
if (!existsSync(WASM_ENTRY)) {
  throw new Error(
    `Rust SauceScript compiler not built at ${WASM_ENTRY}. Run \`pnpm --filter ./sdk build:wasm\` ` +
      '(needs Rust + wasm-pack); the sdk `pretest` runs it automatically.',
  );
}
const { compile } = createRequire(import.meta.url)(WASM_ENTRY) as {
  compile: (options: WasmCompileOptions) => Artifact;
};

const TOKEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'std', 'token');

/** Where a resolved bare `@sauce/token` lands — the layout a Node host's node_modules walk produces. */
const PACKAGE_ROOT = 'node_modules/@sauce/token/';

/** The entry module the compiler asks the resolver for first. */
const ENTRY = 'main.js';

/** The SPL Token program id as the manifest records it: `0x`-prefixed full-width big-endian hex. */
export const SPL_TOKEN_PROGRAM_PUBKEY = '0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9';

/**
 * Serve `entry` as `main.js` and the `@sauce/token` package from `sdk/src/std/token`. A package's own
 * relative import arrives `./`-prefixed (an fs resolver absorbs that in its path join), so the prefix
 * is stripped before matching. A miss — including the unselected sibling arm the probe asks for —
 * throws, which is exactly how a host says "absent".
 */
const resolveModule =
  (entry: string) =>
  (path: string): Uint8Array => {
    const key = path.startsWith('./') ? path.slice(2) : path;

    if (key === ENTRY) return Buffer.from(entry);
    if (!key.startsWith(PACKAGE_ROOT)) throw new Error(`no such module: ${path}`);

    return readFileSync(join(TOKEN_DIR, key.slice(PACKAGE_ROOT.length)));
  };

/** Map the one bare specifier this fixture package layer owns; anything else is "not mine". */
const resolvePackage = (specifier: string): string | undefined =>
  specifier === '@sauce/token' ? `${PACKAGE_ROOT}token.js` : undefined;

/** Compile a program that imports `@sauce/token` for `target`, against the real library source. */
export const compileStdToken = (entry: string, target: Target): Artifact =>
  compile({ target, entry: ENTRY, resolve: resolveModule(entry), resolvePackage });

/** Compile against a caller-supplied resolver — for the packaging negative controls. */
export const compileWith = (options: WasmCompileOptions): Artifact => compile({ entry: ENTRY, ...options });

/**
 * Every exported method, with the entry that calls it on each target. The reads share a signature
 * where the two account models allow (`balanceOf`); where the SPL layout needs the mint as an
 * attached account (`totalSupply`/`decimals`) or a write needs explicit SPL account slots
 * (`transfer`/`transferFrom`/`approve`), the SVM entry diverges — a real, documented divergence, not
 * an accident. The writes are `: void` on both arms.
 */
export interface MethodCase {
  method: string;
  evm: string;
  svm: string;
}

export const CASES: readonly MethodCase[] = [
  {
    method: 'balanceOf',
    evm: 'import { balanceOf } from "@sauce/token"; function main(token: Address, account: Account): Uint256 { return balanceOf(token, account); }',
    svm: 'import { balanceOf } from "@sauce/token"; function main(token: Address, account: Account): Uint256 { return balanceOf(token, account); }',
  },
  {
    method: 'totalSupply',
    evm: 'import { totalSupply } from "@sauce/token"; function main(token: Address): Uint256 { return totalSupply(token); }',
    svm: 'import { totalSupply } from "@sauce/token"; function main(token: Account): Uint256 { return totalSupply(token); }',
  },
  {
    method: 'decimals',
    evm: 'import { decimals } from "@sauce/token"; function main(token: Address): Uint256 { return decimals(token); }',
    svm: 'import { decimals } from "@sauce/token"; function main(token: Account): Uint256 { return decimals(token); }',
  },
  {
    method: 'allowance',
    evm: 'import { allowance } from "@sauce/token"; function main(token: Address, owner: Address, spender: Address): Uint256 { return allowance(token, owner, spender); }',
    svm: 'import { allowance } from "@sauce/token"; function main(token: Address, account: Account, spender: Address): Uint256 { return allowance(token, account, spender); }',
  },
  {
    method: 'transfer',
    evm: 'import { transfer } from "@sauce/token"; function main(token: Address, to: Address, amount: Uint256): void { transfer(token, to, amount); }',
    svm: 'import { transfer } from "@sauce/token"; function main(token: Address, tokenProgram: Account, source: Account, dest: Account, authority: Account, amount: Uint256): void { transfer(token, tokenProgram, source, dest, authority, amount); }',
  },
  {
    method: 'transferFrom',
    evm: 'import { transferFrom } from "@sauce/token"; function main(token: Address, from: Address, to: Address, amount: Uint256): void { transferFrom(token, from, to, amount); }',
    svm: 'import { transferFrom } from "@sauce/token"; function main(token: Address, tokenProgram: Account, source: Account, dest: Account, authority: Account, amount: Uint256): void { transferFrom(token, tokenProgram, source, dest, authority, amount); }',
  },
  {
    method: 'approve',
    evm: 'import { approve } from "@sauce/token"; function main(token: Address, spender: Address, amount: Uint256): void { approve(token, spender, amount); }',
    svm: 'import { approve } from "@sauce/token"; function main(token: Address, tokenProgram: Account, source: Account, delegate: Account, authority: Account, amount: Uint256): void { approve(token, tokenProgram, source, delegate, authority, amount); }',
  },
];
