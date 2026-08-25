/**
 * `@sauce/token` compile conformance, from the CONSUMER side: the library at sdk/src/std/token built
 * through the published `@eco-incorp/sauce-compiler-wasm`, for both targets.
 *
 * Three things are asserted here and nowhere else in this repo:
 *   1. every exported method compiles on both arms, at the signature each arm actually declares;
 *   2. the SVM account manifest — the SDK's attach contract — has the right shape, including the
 *      reachability rule that keeps a read-only import from demanding the SPL Token program;
 *   3. the packaging invariant that there is deliberately NO neutral `token.js`, so a package with no
 *      arm for the target fails on the IMPORT rather than on a missing export.
 *
 * Execution — the compiled bytecode actually running on a real engine and returning the right value —
 * lives in `test/std/token/svm.e2e.test.ts` and `test/std/token/evm.e2e.test.ts`. Both are gated on
 * an env var pointing at a `main`-lineage engine, because the engine artifacts this repo pins
 * (`artifacts/svm/engine.so`, and the V12 runtime `sync-engine-artifacts` generates) come from the
 * `release/beta` lineage and can no longer execute what the published Rust compiler emits. Each of
 * those files documents the divergence; this suite runs unconditionally because compiling needs no
 * engine at all.
 */
import { CASES, compileStdToken, compileWith } from './harness.js';
import type { AccountEntry } from './harness.js';

const slot = (index: number, name: string): AccountEntry => ({ kind: 'slot', index, name });

const manifestOf = (method: string): AccountEntry[] => {
  const testCase = CASES.find((entry) => entry.method === method);
  if (!testCase) throw new Error(`no case named ${method}`);

  const { manifest } = compileStdToken(testCase.svm, 'svm');
  if (!manifest) throw new Error('the svm target must emit a manifest');

  return manifest.accounts;
};

describe('@sauce/token: every exported method compiles on both targets', () => {
  it.each(CASES)('$method', ({ evm, svm }) => {
    const compiledForEvm = compileStdToken(evm, 'evm');
    const compiledForSvm = compileStdToken(svm, 'svm');

    expect(compiledForEvm.bytecode.length).toBeGreaterThan(0);
    expect(compiledForSvm.bytecode.length).toBeGreaterThan(0);
    // The manifest is the SVM attach contract; the EVM has no accounts to attach.
    expect(compiledForEvm.manifest).toBeUndefined();
    expect(compiledForSvm.manifest).toBeDefined();
  });
});

describe('@sauce/token: the SVM account manifest', () => {
  it('a read-only balanceOf manifests its account slot and NO program entry', () => {
    // There is no dead-code elimination, so importing `balanceOf` also lowers the library's
    // `transfer`/`transferFrom`/`approve`, each of which `svm.call`s the SPL Token program. Only the
    // `svm.call`s REACHABLE from `main` are part of the attach contract — otherwise this program
    // would demand an account a pure `svm.sload` read never touches, and which the e2e suite's own
    // `balanceOf` transaction does not attach.
    expect(manifestOf('balanceOf')).toEqual([slot(0, 'account')]);
  });

  it('a write manifests one slot per Account param — the token program rides in as a slot, not a harvested constant', () => {
    // Post-#341 (RS account model) the compiler no longer harvests a constant `svm.call` callee into a
    // `{program,pubkey}` entry; the SPL Token program is a declared `Account` param (`tokenProgram`),
    // so it manifests as an ordinary slot alongside the SPL account slots, in `main`-arg order.
    expect(manifestOf('transfer')).toEqual([
      slot(0, 'tokenProgram'),
      slot(1, 'source'),
      slot(2, 'dest'),
      slot(3, 'authority'),
    ]);
  });

  it('transferFrom manifests the same slots through its delegation to transfer', () => {
    // `transferFrom`'s SVM arm delegates to `transfer` rather than repeating the CPI, so its slots are
    // only found if reachability is TRANSITIVE.
    expect(manifestOf('transferFrom')).toEqual(manifestOf('transfer'));
  });
});

describe('@sauce/token: packaging', () => {
  const entry =
    'import { balanceOf } from "@sauce/token"; function main(): Uint256 { return balanceOf(1n, 2n); }';

  it('a package with no arm for the target fails on the import, not on a missing export', () => {
    // The package ships two arms and no neutral body, because a token program is inherently
    // target-specific. A neutral file that merely RESOLVED would be worse than none: an empty one
    // turns this into "balanceOf is not exported by @sauce/token" (pointing at the symbol, not the
    // real problem), and one that declared the surface would have to guess signatures the two arms
    // do not share. With no neutral file the arm probe's miss is what it is — the package could not
    // be imported for this target.
    const compileArmless = () =>
      compileWith({
        target: 'evm',
        resolve: (path) => {
          if (path === 'main.js') return Buffer.from(entry);
          throw new Error(`no such module: ${path}`);
        },
        resolvePackage: () => 'node_modules/@sauce/token/token.js',
      });

    // The RS compiler names the target-suffixed arm it tried to resolve (…/token.evm.js) rather than
    // the bare package — still an IMPORT/resolve failure, not "balanceOf is not exported".
    expect(compileArmless).toThrow(/failed to import module.*@sauce\/token/);
  });

  it('an uninstalled package reports PackageNotFound, keeping the host resolver’s own cause', () => {
    const compileUninstalled = () =>
      compileWith({
        target: 'evm',
        resolve: (path) => {
          if (path === 'main.js') return Buffer.from(entry);
          throw new Error(`no such module: ${path}`);
        },
        resolvePackage: () => {
          throw new Error('nothing under node_modules');
        },
      });

    expect(compileUninstalled).toThrow(/`@sauce\/token` is not installed under node_modules/);
    expect(compileUninstalled).toThrow(/nothing under node_modules/);
  });
});
