/**
 * `@sauce/token` compile conformance, from the CONSUMER side: the library at sdk/src/std/token built
 * through the published `@eco-incorp/sauce-compiler`, for both targets.
 *
 * Four things are asserted here and nowhere else in this repo:
 *   1. every exported method compiles on both arms, at the signature each arm actually declares;
 *   2. the SPL Token program id the library pins its `require`s to, counted in the emitted bytecode;
 *   3. what the library demands of its caller, which only a compile failure can show — the manifest
 *      cannot, being exactly `main`'s own `Account` params;
 *   4. the packaging invariant that there is deliberately NO neutral `token.js`, so a package with no
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
import { address, getAddressCodec } from '@solana/kit';
import { CASES, compileStdToken, compileWith } from './harness.js';
import type { AccountEntry } from './harness.js';

const slot = (index: number, name: string): AccountEntry => ({ kind: 'slot', index, name });

const svmEntry = (method: string): string => {
  const testCase = CASES.find((entry) => entry.method === method);
  if (!testCase) throw new Error(`no case named ${method}`);

  return testCase.svm;
};

const manifestOf = (method: string): AccountEntry[] => {
  const { manifest } = compileStdToken(svmEntry(method), 'svm');
  if (!manifest) throw new Error('the svm target must emit a manifest');

  return manifest.accounts;
};

/**
 * The SPL Token program id as hex, derived from the canonical base58 address rather than copied from
 * the library. A copy would agree with the library's constant however wrong that constant was, which
 * is the one thing this must not do.
 */
const SPL_TOKEN_PROGRAM = Buffer.from(getAddressCodec().encode(address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'))).toString('hex');

/** How many times the compiled program carries the id inline — one per `require` that pins it. */
const pinnedProgramIds = (method: string): number =>
  Buffer.from(compileStdToken(svmEntry(method), 'svm').bytecode).toString('hex').split(SPL_TOKEN_PROGRAM).length - 1;

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

describe('@sauce/token: the SPL Token program id', () => {
  // Every `require(… == SPL_TOKEN_PROGRAM)` compiles the id inline, so counting occurrences counts the
  // guards. Nothing else in CI can: the guards only *fire* on an engine, and both e2e suites that own
  // one are env-gated. Without this, flipping a digit of the constant — or deleting the guards
  // outright — is green here, which is exactly the failure the library's own comments warn about.
  //
  // A read pins the account's owner. A write pins the owner and, separately, the callee it CPIs into,
  // so the count also catches losing one of the two. And because an unreachable function is never
  // emitted, a read's count stays at one: were the library's three writes lowered in too, it would be
  // five, so this is also where a regression in that pruning would surface.
  it.each([
    ['balanceOf', 1],
    ['totalSupply', 1],
    ['decimals', 1],
    ['allowance', 1],
    ['transfer', 2],
    ['transferFrom', 2],
    ['approve', 2],
  ])('%s pins it %i time(s)', (method, expected) => {
    expect(pinnedProgramIds(method)).toBe(expected);
  });
});

describe('@sauce/token: what the library demands of its caller', () => {
  // The manifest is exactly `main`'s declared `Account` params — an empty `main` with the same
  // signature yields the identical one — so it cannot witness anything about the library. A compile
  // failure can.
  it('a write does not compile unless the caller declares an Account for the callee', () => {
    const withoutTokenProgram =
      'import { transfer } from "@sauce/token"; function main(token: Address, source: Account, dest: Account, authority: Account, amount: Uint256): void { transfer(token, source, dest, authority, amount); }';

    expect(() => compileStdToken(withoutTokenProgram, 'svm')).toThrow('expected an account, found a number');
  });

  it('a write does not compile with a plain address in the callee position', () => {
    // `svm.call`'s callee is an account the caller attaches, not a value — so an `Address` is refused
    // rather than compiled into a call against a key nobody attached.
    const addressAsCallee =
      'import { transfer } from "@sauce/token"; function main(token: Address, tokenProgram: Address, source: Account, dest: Account, authority: Account, amount: Uint256): void { transfer(token, tokenProgram, source, dest, authority, amount); }';

    expect(() => compileStdToken(addressAsCallee, 'svm')).toThrow('expected an account, found a number');
  });

  it('a read demands no program account', () => {
    // The counterpart, and the real content of "a read-only import does not drag the callee in".
    // Importing the library brings `transfer`/`transferFrom`/`approve` into scope and each CPIs into
    // the SPL Token program, but an unreachable function is never emitted, so none of them reaches
    // the bytecode. The counts above are the evidence rather than this comment: a read pins the
    // program id ONCE, where lowering the three writes in would put it there five times.
    expect(manifestOf('balanceOf')).toEqual([slot(0, 'account')]);
  });
});

describe('@sauce/token: the attach order the e2e suites resolve by name', () => {
  // These pin the CASES entries above, not library behaviour: on 0.4.x the manifest is `main`'s
  // `Account` params in declaration order, so what they protect is the agreement between those
  // signatures and the accounts `svm.e2e.test.ts` attaches. Change a signature there, change this.
  it.each([
    ['transfer', ['tokenProgram', 'source', 'dest', 'authority']],
    ['transferFrom', ['tokenProgram', 'source', 'dest', 'authority']],
    ['approve', ['tokenProgram', 'source', 'delegate', 'authority']],
  ])('%s', (method, names) => {
    expect(manifestOf(method)).toEqual(names.map((name, index) => slot(index, name)));
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
    // Absence is a returned `undefined`, never a throw — a throw means "present but unreadable" and
    // would make this a hard read failure rather than the missing arm it is meant to be.
    const compileArmless = () =>
      compileWith({
        target: 'evm',
        resolve: (path) => (path === 'main.js' ? Buffer.from(entry) : undefined),
        resolvePackage: () => 'node_modules/@sauce/token/token.js',
      });

    expect(compileArmless).toThrow(/failed to import module "@sauce\/token"/);
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
