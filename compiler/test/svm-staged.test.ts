/**
 * Staged svm compilation (execute_from_account) — the payload-args lowering
 * (ONE CALLDATA parked in VALUES slot 0, then per-arg SLICE(L + offset, len)
 * + CAST_BE instead of baked literals), the argsLayout payload contract, and
 * the staged-mode gates. Byte fixtures follow the house style: hex string + a
 * comment decoding them.
 */
import { compile } from '../src/index.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

describe('staged svm — arg lowering (byte-exact, 2-arg program in both modes)', () => {
  const src = 'function main(a, b) { return a + b }';

  it('inline mode bakes the literal args into the prologue', () => {
    const r = compile(src, { target: 'svm', args: [7n, 5n] });

    // [BYTE_1 07][BYTE_1 05] — the baked values — then main: [SDUP2][SDUP2][ADD][MSTORE][STOP]
    expect(hex(r.bytecode[0])).toBe('01070105d1d121f200');
    expect(r.argsLayout).toBeUndefined();
  });

  it('staged mode reads each arg from the CALLDATA composite: park once, SLICE + CAST_BE per arg', () => {
    const r = compile(src, { target: 'svm', staged: true, args: [7n, 5n] });

    // L = 26 (0x001a): [CALLDATA a5][WRITE_VALUE 0 c100] — the composite parked once — then
    // arg0: [READ_VALUE 0 5000][BYTE_2 001a][BYTE_1 20][SLICE 95][CAST_BE 54]  (32 bytes at L + 0)
    // arg1: [READ_VALUE 0 5000][BYTE_2 003a][BYTE_1 20][SLICE 95][CAST_BE 54]  (32 bytes at L + 32)
    // main body unchanged: [SDUP2][SDUP2][ADD][MSTORE][STOP]
    expect(hex(r.bytecode[0])).toBe('a5c100500002001a01209554500002003a01209554d1d121f200');
    expect(r.bytecode[0].length).toBe(26); // the SLICE offsets embed exactly this length
    expect(r.argsLayout).toEqual({
      mode: 'calldata',
      programLength: 26,
      byteLength: 64,
      slots: [
        { arg: 0, kind: 'scalar', offset: 0, length: 32 },
        { arg: 1, kind: 'scalar', offset: 32, length: 32 },
      ],
    });
  });

  it('the arg VALUES do not change the staged bytecode — one buffer serves every argument set', () => {
    const a = compile(src, { target: 'svm', staged: true, args: [7n, 5n] });
    const b = compile(src, { target: 'svm', staged: true, args: [123456789n, 987654321n] });

    expect(hex(a.bytecode[0])).toBe(hex(b.bytecode[0]));
  });

  it('a bytes arg SLICEs its slot WITHOUT CAST_BE (Bytes descriptor, like the inline literal)', () => {
    const src = 'function main(d) { return d }';
    const inline = compile(src, { target: 'svm', args: ['0xdeadbeef'] });
    const staged = compile(src, { target: 'svm', staged: true, args: ['0xdeadbeef'] });

    // inline: [BYTES 90][len 04][de ad be ef] then [SDUP1][MSTORE][STOP]
    expect(hex(inline.bytecode[0])).toBe('9004deadbeefd0f200');
    // staged (L = 14, 0x000e): [CALLDATA][WRITE_VALUE 0] then
    // [READ_VALUE 0][BYTE_2 000e][BYTE_1 04][SLICE] — 4 bytes at L + 0, no cast
    expect(hex(staged.bytecode[0])).toBe('a5c100500002000e010495d0f200');
    expect(staged.argsLayout).toEqual({
      mode: 'calldata',
      programLength: 14,
      byteLength: 4,
      slots: [{ arg: 0, kind: 'bytes', offset: 0, length: 4 }],
    });
  });

  it('slots pack back to back: a 40-byte bytes arg advances the next slot by exactly 40', () => {
    const r = compile('function main(a, d, b) { return a + b }', {
      target: 'svm',
      staged: true,
      args: [1n, '0x' + 'ab'.repeat(40), 2n],
    });

    expect(r.argsLayout).toEqual({
      mode: 'calldata',
      programLength: r.bytecode[0].length,
      byteLength: 104,
      slots: [
        { arg: 0, kind: 'scalar', offset: 0, length: 32 },
        { arg: 1, kind: 'bytes', offset: 32, length: 40 },
        { arg: 2, kind: 'scalar', offset: 72, length: 32 },
      ],
    });
  });

  it('emits exactly ONE CALLDATA however many args there are (the composite copy is paid once)', () => {
    const r = compile('function main(a, b, c, d) { return a + b + c + d }', {
      target: 'svm',
      staged: true,
      args: [1n, 2n, 3n, 4n],
    });

    // 0xa5 appears once as an opcode; the fixture's SLICE offsets/lengths stay
    // clear of the byte, so counting occurrences pins the single emission.
    expect(r.bytecode[0].filter((b) => b === 0xa5)).toHaveLength(1);
  });

  it('a no-arg staged program carries an (empty) argsLayout with the program length', () => {
    const r = compile('function main() { return 1 }', { target: 'svm', staged: true });

    expect(r.argsLayout).toEqual({
      mode: 'calldata',
      programLength: r.bytecode[0].length,
      byteLength: 0,
      slots: [],
    });
    // no args → no prologue: byte-identical to the inline compile
    expect(hex(r.bytecode[0])).toBe(hex(compile('function main() { return 1 }', { target: 'svm' }).bytecode[0]));
  });
});

describe('staged svm — account plan', () => {
  it('reserves nothing: user refs intern from index 0 (no args PDA, no payer slot)', () => {
    const r = compile('function main(a) { return a }', { target: 'svm', staged: true, args: [1n] });

    expect(r.accountPlan).toEqual({ metas: [] });
  });

  it('user refs occupy the same indices as an inline compile', () => {
    const src = "function main() { return accountData('pool', 0, 8) }";
    const staged = compile(src, { target: 'svm', staged: true });
    const inline = compile(src, { target: 'svm' });

    expect(staged.accountPlan).toEqual(inline.accountPlan);
    expect(staged.accountPlan!.metas.map((m) => m.ref)).toEqual(['pool']);
  });

  it('a raw-index staged program still compiles (the caller owns the whole ordering)', () => {
    const r = compile('function main() { return accountData(0, 0, 8) }', { target: 'svm', staged: true });

    expect(r.accountPlan!.usesRawIndices).toBe(true);
  });
});

describe('staged svm — gates and validation', () => {
  it('rejects staged with a non-svm target', () => {
    expect(() => compile('function main() { return 1 }', { target: 'v12', staged: true })).toThrow(
      "staged compilation requires target 'svm', got 'v12'",
    );
    expect(() => compile('function main() { return 1 }', { staged: true })).toThrow(
      "staged compilation requires target 'svm', got 'v1'",
    );
  });

  it('rejects ctx.msgData() (the arg prologue owns the single CALLDATA) — formerly msg.data', () => {
    const src = 'function main() { const d = ctx.msgData(); return d[0] }';

    expect(() => compile(src, { target: 'svm', staged: true })).toThrow(
      /ctx\.msgData\(\) is not supported in staged svm mode/,
    );
    // inline svm keeps it
    expect(() => compile(src, { target: 'svm' })).not.toThrow();
  });

  it('rejects array args (ABI-encode to bytes instead)', () => {
    expect(() => compile('function main(a) { return a }', { target: 'svm', staged: true, args: [[1n, 2n]] })).toThrow(
      'staged svm args do not support array values (arg 0)',
    );
  });

  it('rejects an arg set that overflows the 65,535-byte CALLDATA composite', () => {
    const r = () =>
      compile('function main(d) { return d }', {
        target: 'svm',
        staged: true,
        args: ['0x' + '00'.repeat(66_000)],
      });

    expect(r).toThrow(/exceeds the 65535-byte CALLDATA composite ceiling/);
  });

  it('staged bytecode is budgeted against the staged packet shape (no bytecode-size warning)', () => {
    const body = Array.from({ length: 250 }, (_, i) => `storage.tWrite(${i}, 42);`).join('\n');
    const inline = compile(`function main() { ${body} }`, { target: 'svm' });
    const staged = compile(`function main() { ${body} }`, { target: 'svm', staged: true });

    expect(inline.warnings.length).toBeGreaterThan(0);
    expect(staged.warnings).toEqual([]);
  });
});
