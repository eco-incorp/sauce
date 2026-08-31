import { compile } from '../src/index.js';

/**
 * `rejectV1ScalarToDynamicReassignment` (processor/statement.ts) — a sweep-finding fix
 * (see CLAUDE.md's "Same-file user-function return-kind inference" note, "sweep finding
 * 5"): v1 cannot re-class an already-declared slot (`Saucer.store` always uses the
 * EXISTING variable's own tracked kind once one exists, silently ignoring whatever kind
 * a later store computes), so assigning a provably-DYNAMIC value into a variable first
 * declared SCALAR used to compile cleanly and then drop the value's descriptor at
 * runtime — a later indexed read/write faulted `SauceInvalidOperationArgs` (confirmed via
 * real EVM execution: `let s = 5n; s = [10n, 20n, 30n]; return s[0];` reverts
 * `SauceInvalidOperationArgs(0x97)` (INDEX) on v1 today). This is now a clear COMPILE-TIME
 * error instead — the "can't repair it" rejection Option B of that sweep finding.
 *
 * A companion fix in the SAME finding (Option A, `processTernaryStore`'s branchKind
 * promotion) makes the FIRST declaration of such a variable (not a reassignment) resolve
 * to the correct 'dynamic' kind up front, so it round-trips correctly instead of ever
 * needing this rejection — see `integration-test/dynamic-kind-sweep.test.ts` for the real
 * EVM-execution proof of that positive case.
 *
 * v12/svm are unaffected by any of this: `V12Saucer.store` derives the real storage kind
 * straight from `value.isDynamic`, never from an existing variable's stale tag, so there
 * is no descriptor at risk to guard against — every shape here compiles cleanly on v12.
 */
describe('rejectV1ScalarToDynamicReassignment (v1 scalar → dynamic reassignment guard)', () => {
  it('rejects a plain reassignment of an existing scalar to a dynamic array literal', () => {
    expect(() => compile('function main() { let s = 5n; s = [10n, 20n, 30n]; return s[0]; }')).toThrow(
      /cannot assign a dynamic value to 's'/,
    );
  });

  it('rejects a plain reassignment of an existing scalar to an existing dynamic variable (aliasing)', () => {
    const src = `
      function main() {
        const arr = new Array(2);
        arr[0] = 1n;
        let s = 5n;
        s = arr;
        return s[0];
      }
    `;

    expect(() => compile(src)).toThrow(/cannot assign a dynamic value to 's'/);
  });

  it('rejects an if-branch reassignment of an existing scalar to a dynamic value', () => {
    const src = `
      function main(cond) {
        const arr = new Array(2);
        arr[0] = 1n;
        let s = 0n;
        if (cond === 1n) { s = arr; }
        return s[0];
      }
    `;

    expect(() => compile(src)).toThrow(/cannot assign a dynamic value to 's'/);
  });

  it('rejects a ternary reassignment of an existing scalar whose branches are dynamic', () => {
    const src = `
      function main(cond) {
        const arr = new Array(2);
        arr[0] = 1n;
        const other = new Array(2);
        other[0] = 2n;
        let s = 5n;
        s = cond === 1n ? arr : other;
        return s[0];
      }
    `;

    expect(() => compile(src)).toThrow(/cannot assign a dynamic value to 's'/);
  });

  it('does NOT reject the reverse direction: a scalar stored into an already-dynamic slot round-trips fine', () => {
    // Storing a scalar in a HEAP slot round-trips losslessly on v1 (the same rule the
    // mixed-return-function return-kind analysis relies on) — only scalar→dynamic is
    // unsafe, never dynamic→scalar.
    const src = `
      function main() {
        const arr = new Array(2);
        arr[0] = 1n;
        let s = arr;
        s = 9n;
        return s;
      }
    `;

    expect(() => compile(src)).not.toThrow();
  });

  it('does NOT reject a first declaration (only a REassignment is rejected)', () => {
    expect(() => compile('function main() { let s = [10n, 20n, 30n]; return s[0]; }')).not.toThrow();
  });

  it('v12 is unaffected — every rejected v1 shape compiles cleanly on v12', () => {
    const plain = 'function main() { let s = 5n; s = [10n, 20n, 30n]; return s[0]; }';
    const ifBranch = `
      function main(cond) {
        const arr = new Array(2);
        arr[0] = 1n;
        let s = 0n;
        if (cond === 1n) { s = arr; }
        return s[0];
      }
    `;
    const ternary = `
      function main(cond) {
        const arr = new Array(2);
        arr[0] = 1n;
        const other = new Array(2);
        other[0] = 2n;
        let s = 5n;
        s = cond === 1n ? arr : other;
        return s[0];
      }
    `;

    expect(() => compile(plain, { target: 'v12' })).not.toThrow();
    expect(() => compile(ifBranch, { target: 'v12' })).not.toThrow();
    expect(() => compile(ternary, { target: 'v12' })).not.toThrow();
  });
});
