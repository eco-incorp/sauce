/**
 * Planner phase B — the packet budget estimator, its compile() warning surface,
 * and registry behaviors not covered by svm-target.test.ts (signer flag
 * OR-merge, merge combined with helper-function interning order).
 *
 * Budget fixtures are hand-computed from the v0 wire math documented in
 * planner/budget.ts; each fixture's comment names every term. The model always
 * carries the SDK-normative RequestHeapFrame prepend (its ComputeBudget
 * program key is a fixed static key, its instruction 8 bytes). No signer is
 * auto-appended — NoSigner is lazy on both execute paths.
 */
import { compile } from '../src/index.js';
import { estimatePacket, stagingTransactionCount } from '../src/planner/index.js';
import type { AccountPlan } from '../src/planner/index.js';

const compileSvm = (src: string) => compile(src, { target: 'svm' });
const planWith = (n: number): AccountPlan => ({
  metas: Array.from({ length: n }, (_, i) => ({ ref: `a${i}`, writable: false, signer: false })),
});

describe('planner — estimatePacket wire math (inline)', () => {
  it('0 metas, 100-byte bytecode: hand-computed v0 estimate, no warnings', () => {
    expect(estimatePacket(planWith(0), 100)).toEqual({
      mode: 'inline',
      bytecodeBytes: 100,
      instructionDataBytes: 108, // 8 discriminator + 100
      staticAccountKeys: 3, // payer + engine program + ComputeBudget program
      // 65 signatures (1 + 64x1) + 133 message (1 version + 3 header + 1 count + 3x32 keys + 32 blockhash)
      // + 120 instructions (1 count + 8 RequestHeapFrame + (1 program-id + 1 count + 0 indices
      // + 1 data len + 108 data)) + 1 empty ALT
      messageBytes: 319,
      limitBytes: 1232,
      overflowBytes: 0,
      accountLocks: 3,
      lockLimit: 64,
      warnings: [],
    });
  });

  it('25 metas, 900-byte bytecode: overflows the packet and warns', () => {
    const b = estimatePacket(planWith(25), 900);

    expect(b.instructionDataBytes).toBe(908);
    expect(b.staticAccountKeys).toBe(28); // 3 fixed + 25 user metas
    // 65 signatures + 933 message (1+3+1 + 28x32 + 32)
    // + 946 instructions (1 + 8 + (1 + 1 + 25 indices + 2 data len (908 >= 128) + 908 data)) + 1 empty ALT
    expect(b.messageBytes).toBe(1945);
    expect(b.overflowBytes).toBe(713);
    expect(b.accountLocks).toBe(28); // under the lock cap: only the packet warning
    expect(b.warnings).toEqual([
      'transaction exceeds the 1232-byte packet by 713 bytes; stage the bytecode (execute_from_account), use address lookup tables, or trim bytecode',
    ]);
  });

  it('lookupAddresses shift keys out of the static section (locks unchanged)', () => {
    const direct = estimatePacket(planWith(25), 100);
    const viaAlt = estimatePacket(planWith(25), 100, { lookupTables: 1, lookupAddresses: 20 });

    expect(direct.staticAccountKeys).toBe(28);
    expect(direct.messageBytes).toBe(1144); // 65 + 933 + 145 (1 + 8 + (1+1+25+1+108)) + 1
    expect(viaAlt.staticAccountKeys).toBe(8); // 3 fixed + (25 - 20) non-ALT metas
    expect(viaAlt.accountLocks).toBe(28); // locks count ALT-resolved accounts too
    // each shifted key trades 32 static-key bytes for a 1-byte ALT index; the table itself adds 34
    expect(viaAlt.messageBytes).toBe(direct.messageBytes - 20 * 32 + 20 + 34); // = 558
    expect(viaAlt.warnings).toEqual([]);
  });

  it('65 locks warn even when the packet fits (ALT-resolved)', () => {
    const b = estimatePacket(planWith(62), 100, { lookupTables: 1, lookupAddresses: 62 });

    expect(b.accountLocks).toBe(65); // 3 static + 62 ALT-resolved
    expect(b.messageBytes).toBe(477); // 65 + 133 + 182 (1 + 8 + (1+1+62+1+108)) + 97 (1 + 34 + 62)
    expect(b.overflowBytes).toBe(0);
    expect(b.warnings).toEqual(['account locks (65) exceed the runtime cap of 64']);
  });

  it('both warnings surface together, packet first', () => {
    const b = estimatePacket(planWith(62), 900);

    // 65 + 2117 (1+3+1 + 65x32 + 32) + 983 (1 + 8 + (1+1+62+2+908)) + 1 = 3166
    expect(b.messageBytes).toBe(3166);
    expect(b.warnings).toEqual([
      'transaction exceeds the 1232-byte packet by 1934 bytes; stage the bytecode (execute_from_account), use address lookup tables, or trim bytecode',
      'account locks (65) exceed the runtime cap of 64',
    ]);
  });

  it('plan-declared signer metas raise the default signature count', () => {
    const plan: AccountPlan = { metas: [{ ref: 'delegate', writable: false, signer: true }] };
    const b = estimatePacket(plan, 950);

    // 2 signatures — fee payer + the plan-declared signer: 129 (1 + 64x2)
    // + 165 message (1+3+1 + 4x32 + 32) + 972 instructions (1 + 8 + (1 + 1
    // + 1 index + 2 data len + 958 data)) + 1 empty ALT = 1267 — 35 over the packet
    expect(b.messageBytes).toBe(1267);
    expect(b.overflowBytes).toBe(35);
    expect(b.warnings).toEqual([
      'transaction exceeds the 1232-byte packet by 35 bytes; stage the bytecode (execute_from_account), use address lookup tables, or trim bytecode',
    ]);
    // an explicit count overrides the plan-derived default (signer ref bound to the fee payer)
    expect(estimatePacket(plan, 950, { signers: 1 }).overflowBytes).toBe(0);
  });

  it("the reserved 'payer' ref adds no signature, static key, or lock — only its index byte", () => {
    const plan: AccountPlan = {
      metas: [
        { ref: 'payer', writable: true, signer: true },
        { ref: 'pool', writable: false, signer: false },
      ],
    };
    const b = estimatePacket(plan, 100);

    expect(b.staticAccountKeys).toBe(4); // 3 fixed (fee payer included) + pool only
    expect(b.accountLocks).toBe(4);
    // 65 signatures (1 + 64x1 — the payer meta IS the fee payer) + 165 message
    // (1+3+1 + 4x32 + 32) + 122 instructions (1 + 8 + (1 + 1 + 2 indices (BOTH
    // metas) + 1 data len + 108 data)) + 1 empty ALT
    expect(b.messageBytes).toBe(353);
    expect(b.warnings).toEqual([]);
  });

  it('prependBytes reserves headroom byte-for-byte (e.g. ~8 for a ComputeBudget unit-limit prepend)', () => {
    const base = estimatePacket(planWith(0), 100);
    const withPrepend = estimatePacket(planWith(0), 100, { prependBytes: 8 });

    expect(withPrepend.messageBytes).toBe(base.messageBytes + 8);
  });

  it('key-count prefix grows to 2 bytes at 128 static keys (metas >= 125)', () => {
    const b = estimatePacket(planWith(125), 100);

    expect(b.staticAccountKeys).toBe(128);
    // 65 signatures + 4134 message (1+3+2 (compact key count >= 128) + 128x32 + 32)
    // + 245 instructions (1 + 8 + (1 + 1 + 125 indices + 1 data len + 108 data)) + 1 empty ALT
    expect(b.messageBytes).toBe(4445);
  });

  it('per-table index-count prefix grows to 2 bytes at 128 ALT-resolved addresses', () => {
    const b = estimatePacket(planWith(130), 100, { lookupTables: 1, lookupAddresses: 128 });

    // 65 signatures + 197 message (1+3+1 + 5x32 + 32) + 251 instructions
    // (1 + 8 + (1 + 2 (compact account count >= 128) + 130 indices + 1 data len + 108 data))
    // + 164 ALT (1 + 32 + 2 (compact index count >= 128) + 1 + 128 indices)
    expect(b.messageBytes).toBe(677);
  });

  it('rejects lookup options inconsistent with the plan', () => {
    expect(() => estimatePacket(planWith(5), 100, { lookupTables: 1, lookupAddresses: 10 })).toThrow(
      "lookupAddresses (10) exceeds the plan's account metas (5)",
    );
    expect(() => estimatePacket(planWith(5), 100, { lookupAddresses: 3 })).toThrow(
      'lookupAddresses (3) requires lookupTables > 0, got 0',
    );
  });

  it('is pure: the same input twice yields deep-equal results and leaves the plan untouched', () => {
    const plan = planWith(3);
    const opts = { signers: 2, lookupTables: 1, lookupAddresses: 2 };

    expect(estimatePacket(plan, 500, opts)).toEqual(estimatePacket(plan, 500, opts));
    expect(plan).toEqual(planWith(3));
  });
});

describe('planner — estimatePacket staged mode', () => {
  it('16 KB of bytecode fits trivially: data is disc + flags + hash pin, not the program', () => {
    const b = estimatePacket(planWith(0), 16 * 1024, { mode: 'staged' });

    expect(b.mode).toBe('staged');
    expect(b.bytecodeBytes).toBe(16384);
    expect(b.instructionDataBytes).toBe(41); // 8 discriminator + 1 flags + 32-byte content-hash pin
    expect(b.staticAccountKeys).toBe(4); // payer + program + ComputeBudget program + buffer
    // 65 signatures + 165 message (1+3+1 + 4x32 + 32) + 54 instructions
    // (1 + 8 + (1 + 1 + 1 buffer index + 1 data len + 41 data)) + 1 empty ALT
    expect(b.messageBytes).toBe(285);
    expect(b.overflowBytes).toBe(0);
    expect(b.accountLocks).toBe(4);
    expect(b.argsBudgetBytes).toBe(939); // 939 - 33x0 user accounts
    expect(b.stagingTxs).toBe(20); // 1 init + 17 writes + 1 finalize + 1 execute
    expect(b.warnings).toEqual([]);
  });

  it('pins the staging tx totals: 8/12/20 for 4/8/16 KB', () => {
    expect(stagingTransactionCount(4 * 1024)).toBe(8);
    expect(stagingTransactionCount(8 * 1024)).toBe(12);
    expect(stagingTransactionCount(16 * 1024)).toBe(20);
    expect(estimatePacket(planWith(0), 4 * 1024, { mode: 'staged' }).stagingTxs).toBe(8);
    expect(estimatePacket(planWith(0), 8 * 1024, { mode: 'staged' }).stagingTxs).toBe(12);
  });

  it('payload args ride the instruction data and are budgeted at 939 - 33N', () => {
    const atBudget = estimatePacket(planWith(0), 1000, { mode: 'staged', argsBytes: 939 });

    expect(atBudget.instructionDataBytes).toBe(41 + 939);
    expect(atBudget.argsBudgetBytes).toBe(939);
    expect(atBudget.warnings).toEqual([]);

    const overBudget = estimatePacket(planWith(0), 1000, { mode: 'staged', argsBytes: 940 });

    expect(overBudget.warnings).toEqual([
      'staged payload args (940 bytes) exceed the 939-byte packet budget (939 − 33·N at N = 0 user accounts); ' +
        'move bulk data into a second buffer read via accountData',
    ]);

    // each extra user account costs 33 bytes of args budget (32-byte key +
    // 1-byte index) — the budget line trips BEFORE the optimistic v0 estimate
    // itself overflows (the engine pin carries the CU-limit prepend too).
    const withAccounts = estimatePacket(planWith(6), 1000, { mode: 'staged', argsBytes: 742 });

    expect(withAccounts.argsBudgetBytes).toBe(939 - 33 * 6);
    expect(withAccounts.overflowBytes).toBe(0);
    expect(withAccounts.warnings).toEqual([
      `staged payload args (742 bytes) exceed the ${939 - 33 * 6}-byte packet budget (939 − 33·N at N = 6 user accounts); ` +
        'move bulk data into a second buffer read via accountData',
    ]);
  });

  it('warns past the 65,535-byte composite (program ++ args) ceiling', () => {
    const b = estimatePacket(planWith(0), 70_000, { mode: 'staged' });

    expect(b.warnings).toEqual([
      'bytecode (70000 bytes) plus payload args (0 bytes) exceeds the 65535-byte composite ceiling',
    ]);
    expect(estimatePacket(planWith(0), 65_000, { mode: 'staged', argsBytes: 600 }).warnings).toEqual([
      'bytecode (65000 bytes) plus payload args (600 bytes) exceeds the 65535-byte composite ceiling',
    ]);
  });

  it('inline vs staged on the same oversized program: only inline overflows the packet', () => {
    const plan = planWith(2);
    const inline = estimatePacket(plan, 5_000);
    const staged = estimatePacket(plan, 5_000, { mode: 'staged' });

    expect(inline.overflowBytes).toBeGreaterThan(0);
    expect(staged.overflowBytes).toBe(0);
    expect(staged.instructionDataBytes).toBe(41);
  });

  it('account locks still warn in staged mode (the buffer adds one)', () => {
    const b = estimatePacket(planWith(61), 100, { mode: 'staged', lookupTables: 1, lookupAddresses: 61 });

    // 4 fixed (incl. buffer) + 61 ALT-resolved user metas = 65 locks, with the
    // keys shifted out of the static section so only the lock cap warns (the
    // args budget goes deeply negative but no args are sent).
    expect(b.accountLocks).toBe(65);
    expect(b.warnings).toEqual(['account locks (65) exceed the runtime cap of 64']);
  });
});

describe('planner — compile() packet-budget warnings (target svm)', () => {
  it('a small zero-meta program compiles with zero warnings', () => {
    expect(compileSvm('function main() { return 42 }').warnings).toEqual([]);
  });

  it('an oversized program surfaces the overflow warning (non-fatal)', () => {
    // 250 tWrite statements x 5 bytes ([BYTE_1,42][BYTE_1,i][TSTORE]) ≈ 1250 bytes of bytecode.
    const body = Array.from({ length: 250 }, (_, i) => `storage.tWrite(${i}, 42);`).join('\n');
    const r = compileSvm(`function main() { ${body} }`);
    const budget = estimatePacket(r.accountPlan!, r.bytecode[0].length);

    expect(budget.overflowBytes).toBeGreaterThan(0);
    expect(r.warnings).toEqual(budget.warnings);
    expect(r.warnings).toEqual([
      expect.stringMatching(
        /^transaction exceeds the 1232-byte packet by \d+ bytes; stage the bytecode \(execute_from_account\), use address lookup tables, or trim bytecode$/,
      ),
    ]);
  });

  it('the same oversized program compiles warning-free as staged', () => {
    const body = Array.from({ length: 250 }, (_, i) => `storage.tWrite(${i}, 42);`).join('\n');
    const r = compile(`function main() { ${body} }`, { target: 'svm', staged: true });

    expect(r.warnings).toEqual([]);
  });

  it('a staged compile with over-budget payload args warns through compile()', () => {
    const r = compile('function main(a, d) { return a }', {
      target: 'svm',
      staged: true,
      args: [0n, '0x' + 'ab'.repeat(1000)], // 32 + 1000 = 1032 arg bytes > 939
    });

    expect(r.warnings.join('\n')).toContain('staged payload args (1032 bytes) exceed the 939-byte packet budget');
  });
});

describe('planner — registry merge/ordering (gaps left by svm-target.test.ts)', () => {
  it('re-interning merges the signer flag; helper-first interning fixes the order', () => {
    const r = compileSvm(`
      function readPayer() { return accountData('payer', 0, 8) }
      function main() {
        writeAccountData('vault', 0, Uint8Array.from([0x01]));
        return contract.call(7, readPayer(), [{ ref: 'payer', signer: true }, 'vault']);
      }
    `);

    // 'payer' interned first (readonly non-signer, in readPayer — helpers compile
    // before main) then merged signer by main's call list; 'vault' interned second
    // via writeAccountData (writable) and re-interned plain without losing the flag.
    expect(r.accountPlan).toEqual({
      metas: [
        { ref: 'payer', writable: false, signer: true },
        { ref: 'vault', writable: true, signer: false },
      ],
    });
  });

  it('a signer flag is sticky across later plain uses of the ref', () => {
    const r = compileSvm(`
      function main() {
        return contract.call(7, Uint8Array.from([0xaa]), [{ ref: 'payer', signer: true }, 'payer']);
      }
    `);

    expect(r.accountPlan).toEqual({ metas: [{ ref: 'payer', writable: false, signer: true }] });
  });
});
