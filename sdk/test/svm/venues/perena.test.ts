/**
 * Perena adapter emitQuote units (no engine): the Account-model migration —
 * `accountUint("<ref>", …)` string refs replaced by `svm.sload(acc<k>, …).toLe()`
 * reads through main()'s ordered `Account` params (k = the ref's index in
 * quoteAccounts, which for perena is [pool=acc0]) — and the RS/svm compile that
 * produces the account manifest in that param order.
 *
 * The compile also exercises the ~7-level-deep nested-if closed-form solver
 * `arithmeticLines` emits: RS's if-arm local-liveness reconciliation (#386) is
 * what lets those branch-local `const`s drop cleanly at each merge point.
 *
 * Perena has no venue fixture in this worktree (only the barrel-surface export
 * check), so — like hylo.test.ts — a minimal synthetic cfg suffices: emitQuote
 * consults only `venue`, `direction`, `ampRaw` and `aRaw`; the remaining
 * PerenaPoolConfig fields are prepare-time gate snapshots the fragment never reads.
 */
import { compileSvm, wrapQuoteMain } from '../rs-compile.js';
import { perena } from '../../../src/svm/venues/perena/index.js';
import type { PoolConfig } from '../../../src/svm/venues/types.js';

const POOL = '2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ';

// emitQuote reads only these four fields; the rest are unread prepare-time snapshots.
const baseCfg = {
  venue: 'perena',
  pool: POOL,
  direction: 'aToB',
  ampRaw: 100_000_000n,
  aRaw: 1_000_000n,
} as unknown as PoolConfig;

const aToB = { ...(baseCfg as object), direction: 'aToB' } as unknown as PoolConfig;
const bToA = { ...(baseCfg as object), direction: 'bToA' } as unknown as PoolConfig;

describe('perena adapter identity', () => {
  it('identifies itself', () => {
    expect(perena.slug).toBe('perena');
  });
});

describe('perena quoteAccounts', () => {
  it('attaches only the pool (acc0), ref = perena:<pool>:pool, address = the pool', () => {
    expect(perena.quoteAccounts(aToB)).toEqual([{ ref: `perena:${POOL}:pool`, address: POOL }]);
  });
});

describe('perena emitQuote (Account model)', () => {
  it('reads the 8 pool fields via svm.sload(acc0, …).toLe(), never accountUint', () => {
    const fragment = perena.emitQuote(aToB, 0, 1_000_000n);
    expect(fragment).not.toContain('accountUint(');
    expect(fragment).toContain('const s0xin = svm.sload(acc0,');
    expect(fragment).toContain('.toLe();');
    expect(fragment).toContain('const s0fn = svm.sload(acc0,');
    expect(fragment).toContain('const s0fd = svm.sload(acc0,');
    // The closed-form solver arithmetic is unchanged (Math.mulDiv / Math.sqrt).
    expect(fragment).toContain('Math.sqrt(');
    expect(fragment).toContain('Math.mulDiv(');
  });

  it('compiles for the svm target, manifesting the single pool slot in param order (both directions)', () => {
    for (const cfg of [aToB, bToA]) {
      const accounts = perena.quoteAccounts(cfg);
      const { bytecode, manifest } = compileSvm(wrapQuoteMain(accounts.length, perena.emitQuote(cfg, 0, 1_000_000n), 'q0'));
      expect(bytecode.length).toBeGreaterThan(0);
      expect(manifest?.accounts).toEqual([{ kind: 'slot', index: 0, name: 'acc0', requires: 'readonly' }]);
      const bound = manifest?.accounts.map((meta) => (meta.kind === 'slot' ? accounts[meta.index]?.address : undefined));
      expect(bound).toEqual([POOL]);
    }
  });
});
