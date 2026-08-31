import { Saucer, OPS } from '../src/saucer/index.js';
import { CompilerContext } from '../src/context.js';

describe('saucer', () => {
  it('uses IF_2 for large then body', () => {
    const ctx = new CompilerContext();
    const saucer = new Saucer(ctx);
    const condition = saucer.int(1n);
    const thenBody = new Saucer(ctx);
    (thenBody as { _bytes: Uint8Array })._bytes = new Uint8Array(300);

    const result = saucer.if(condition).then(thenBody);
    expect(result._bytes[0]).toBe(OPS.IF_2);
    expect(result._bytes[1]).toBe(1);
    expect(result._bytes[2]).toBe(44);
  });

  it('uses IF_2 and JUMP_2 for large else body', () => {
    const ctx = new CompilerContext();
    const saucer = new Saucer(ctx);
    const condition = saucer.int(1n);
    const thenBody = new Saucer(ctx);
    (thenBody as { _bytes: Uint8Array })._bytes = new Uint8Array(300);
    const elseBody = new Saucer(ctx);
    (elseBody as { _bytes: Uint8Array })._bytes = new Uint8Array(400);

    const result = saucer.if(condition).then(thenBody).else(elseBody);
    // IF_2 skip = thenBody(300) + JUMP_2(1) + jumpOperand(2) = 303
    expect(result._bytes[0]).toBe(OPS.IF_2);
    expect(result._bytes[1]).toBe(1);
    expect(result._bytes[2]).toBe(47);
    // JUMP_2 at offset: IF_2(1) + skip(2) + condition(2) + thenBody(300) = 305
    expect(result._bytes[305]).toBe(OPS.JUMP_2);
    expect(result._bytes[306]).toBe(1);
    expect(result._bytes[307]).toBe(144);
  });

  it('throws when if body exceeds 65535 bytes', () => {
    const ctx = new CompilerContext();
    const saucer = new Saucer(ctx);
    const condition = saucer.int(1n);
    const thenBody = new Saucer(ctx);
    (thenBody as { _bytes: Uint8Array })._bytes = new Uint8Array(65536);

    expect(() => saucer.if(condition).then(thenBody)).toThrow('body too large: 65536 bytes exceeds 65535');
  });

  it('throws when else body exceeds 65535 bytes', () => {
    const ctx = new CompilerContext();
    const saucer = new Saucer(ctx);
    const condition = saucer.int(1n);
    const thenBody = new Saucer(ctx);
    (thenBody as { _bytes: Uint8Array })._bytes = new Uint8Array(300);
    const elseBody = new Saucer(ctx);
    (elseBody as { _bytes: Uint8Array })._bytes = new Uint8Array(65536);

    expect(() => saucer.if(condition).then(thenBody).else(elseBody)).toThrow(
      'body too large: 65536 bytes exceeds 65535',
    );
  });

  it('throws when if skip overflows on else addition', () => {
    const ctx = new CompilerContext();
    const saucer = new Saucer(ctx);
    const condition = saucer.int(1n);
    const thenBody = new Saucer(ctx);
    (thenBody as { _bytes: Uint8Array })._bytes = new Uint8Array(254);
    const elseBody = new Saucer(ctx);
    (elseBody as { _bytes: Uint8Array })._bytes = new Uint8Array(1);

    // 254 + 2 (JUMP) = 256 > 255, overflows 1-byte IF skip
    expect(() => saucer.if(condition).then(thenBody).else(elseBody)).toThrow('body too large: 256 bytes exceeds 255');
  });
});

describe('saucer — SET_INDEX / NEW_ARRAY (v1 prefix)', () => {
  const S = () => new Saucer(new CompilerContext());

  it('setIndex emits [SET_INDEX][value][index][array]', () => {
    const s = S();
    // signature is setIndex(array, index, value); v1 byte order is value, index, array.
    const r = s.setIndex(s.int(7n), s.int(1n), s.int(9n));
    // array=7, index=1, value=9 → [SET_INDEX][9][1][7]
    expect(Array.from(r._bytes)).toEqual([OPS.SET_INDEX, OPS.BYTE_1, 9, OPS.BYTE_1, 1, OPS.BYTE_1, 7]);
  });

  it('newArray emits [NEW_ARRAY][count]', () => {
    const s = S();
    const r = s.newArray(s.int(3n));
    expect(Array.from(r._bytes)).toEqual([OPS.NEW_ARRAY, OPS.BYTE_1, 3]);
  });
});
