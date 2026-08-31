/**
 * `@sauce/token` (sdk/src/std/token) compiled through the published compiler
 * (`@eco-incorp/sauce-compiler`, aliased `sauce-next`). The library ships as SauceScript source, so
 * the only thing that proves it is the compiler that will actually consume it downstream.
 *
 * The library's four files are byte-identical copies of the sauce repo's conformance fixture
 * (`compiler/crates/sauce-cli/tests/fixtures/node_modules/@sauce/token/`), which is the source of truth —
 * port changes from there, never the other way. Nothing in this repo can enforce that: the fixture
 * is not on disk here since the `sauce` git dep went away, so the check is `diff -r` against a
 * local `sauce` checkout. What CI does pin is the SPL Token program id the library guards on —
 * see `compile.test.ts`. The resolver below reproduces what a Node
 * host's `node_modules` walk hands the compiler: a bare `@sauce/token` mapped to the package entry
 * (`resolvePackage`), the package's own relative `./erc20.abi.json` served from the same directory,
 * and a MISS reported by returning `undefined` — the "arm absent" signal the compiler's per-target arm
 * probe (`token.js` → `token.evm.js` / `token.svm.js`) relies on. Absence is a returned `undefined`,
 * not a throw: since compiler 0.2.0 a throw means "present but unreadable" and propagates instead of
 * falling back, so a host that throws for absent turns a missing arm into a hard error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The compiler's own types, not a local restatement of them. A hand-written mirror of a published
// type is exactly the defect 0.4.1 fixed one repo up; re-declaring them here would reintroduce it
// one repo down, with nothing to catch the drift. The package ships them, so they track the
// resolved version for free.
import type { CompileOptions, CompileResult, SauceTarget } from 'sauce-next';

export type { AccountEntry, AccountManifest, CompileOptions, CompileResult, SauceTarget } from 'sauce-next';

// The SauceScript compiler, under the `sauce-next` alias: a workspace package shadowed its real
// name (`@eco-incorp/sauce-compiler`) when the alias was introduced.
//
// Required via `createRequire`, not `import`: the package's `node` condition is a CommonJS build
// that reads its sibling `.wasm` off disk at load. Node's own CJS loader is the one that resolves
// that sibling — jest's ESM transform does not.
const { compile } = createRequire(import.meta.url)('sauce-next') as {
  compile: (options: CompileOptions) => CompileResult;
};

const TOKEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'std', 'token');

/** Where a resolved bare `@sauce/token` lands — the layout a Node host's node_modules walk produces. */
const PACKAGE_ROOT = 'node_modules/@sauce/token/';

/** The entry module the compiler asks the resolver for first. */
const ENTRY = 'main.js';

/**
 * Serve `entry` as `main.js` and the `@sauce/token` package from `sdk/src/std/token`. A package's own
 * relative import arrives `./`-prefixed (an fs resolver absorbs that in its path join), so the prefix
 * is stripped before matching. A miss — including the unselected sibling arm the probe asks for —
 * returns `undefined`, which is how a host says "absent"; throwing would say "present but unreadable".
 */
const resolveModule =
  (entry: string) =>
  (path: string): Uint8Array | undefined => {
    const key = path.startsWith('./') ? path.slice(2) : path;

    if (key === ENTRY) return Buffer.from(entry);
    if (!key.startsWith(PACKAGE_ROOT)) return undefined;

    const file = join(TOKEN_DIR, key.slice(PACKAGE_ROOT.length));

    // `existsSync` rather than catching the read: a caught `ENOENT` would also swallow a permission
    // error or a truncated read, which the contract wants propagated as "present but unreadable".
    return existsSync(file) ? readFileSync(file) : undefined;
  };

/** Map the one bare specifier this fixture package layer owns; anything else is "not mine". */
const resolvePackage = (specifier: string): string | undefined =>
  specifier === '@sauce/token' ? `${PACKAGE_ROOT}token.js` : undefined;

/** Compile a program that imports `@sauce/token` for `target`, against the real library source. */
export const compileStdToken = (entry: string, target: SauceTarget): CompileResult =>
  compile({ target, entry: ENTRY, resolve: resolveModule(entry), resolvePackage });

/** Compile against a caller-supplied resolver — for the packaging negative controls. */
export const compileWith = (options: CompileOptions): CompileResult => compile({ entry: ENTRY, ...options });

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
