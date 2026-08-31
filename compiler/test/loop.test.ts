import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('loop', () => {
  it('compiles basic for loop', () => {
    const result = compile('function main() { for (let i = 0; i < 3; i++) { const x = i; } }');
    // init: [WRITE_VALUE, 0, BYTE_1, 0] = 4
    // cond: [BOOL_LT, READ_VALUE, 0, BYTE_1, 3] = 5
    // body: [WRITE_VALUE, 1, READ_VALUE, 0] = 4
    // update: [WRITE_VALUE, 0, ADD, READ_VALUE, 0, BYTE_1, 1] = 7
    // backCount = 4 + 7 + 2 + 5 + 2 = 20
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.IF,
        20,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        3,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.WRITE_VALUE,
        0,
        OPS.ADD,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.IF,
        2,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        3,
        OPS.JUMP_BACK,
        20,
      ]),
    );
  });

  it('compiles basic while loop', () => {
    const result = compile('function main() { let x = 10; while (x > 0) { let y = x; } }');
    // cond: [BOOL_GT, READ_VALUE, 0, BYTE_1, 0] = 5
    // body: [WRITE_VALUE, 1, READ_VALUE, 0] = 4
    // backCount = 4 + 2 + 5 + 2 = 13
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.IF,
        13,
        OPS.BOOL_GT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.IF,
        2,
        OPS.BOOL_GT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.JUMP_BACK,
        13,
      ]),
    );
  });

  it('compiles infinite for with break', () => {
    const result = compile('function main() { for (;;) { break; } }');
    // body: [JUMP_2, 0, 2] = 3
    // backCount = 3 + 2 = 5
    // break distance = 3 - 1 - 2 + 0 + 2 = 2
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.JUMP_2, 0, 2, OPS.JUMP_BACK, 5]));
  });

  it('compiles while true with break', () => {
    const result = compile('function main() { while (true) { break; } }');
    // cond: [BYTE_1, 1] = 2
    // body: [JUMP_2, 0, 2] = 3 (break placeholder patched)
    // backCount = 3 + 2 + 2 + 2 = 9
    // break distance = backCount - 1 - 2 = 6
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.IF, 9, OPS.BYTE_1, 1, OPS.JUMP_2, 0, 6, OPS.IF, 2, OPS.BYTE_1, 1, OPS.JUMP_BACK, 9]),
    );
  });

  it('compiles for with break in if', () => {
    const result = compile('function main() { for (let i = 0; i < 10; i++) { if (i === 5) break; } }');
    // body: [IF, thenLen, BOOL_EQ, READ_VALUE, 0, BYTE_1, 5, JUMP_2, 0, X] = 10
    // thenLen = 3 (JUMP_2, hi, lo)
    // update: [WRITE_VALUE, 0, ADD, READ_VALUE, 0, BYTE_1, 1] = 7
    // cond: [BOOL_LT, READ_VALUE, 0, BYTE_1, 10] = 5
    // backCount = 10 + 7 + 2 + 5 + 2 = 26
    // break offset in body = 8 (after IF(1)+skip(1)+cond(5)+JUMP_2(1))
    // break distance = 10 - 8 - 2 + 7 + 2 + 5 + 2 = 16
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.IF,
        26,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.IF,
        3,
        OPS.BOOL_EQ,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.JUMP_2,
        0,
        16,
        OPS.WRITE_VALUE,
        0,
        OPS.ADD,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.IF,
        2,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.JUMP_BACK,
        26,
      ]),
    );
  });

  it('compiles for with continue', () => {
    const result = compile('function main() { for (let i = 0; i < 10; i++) { if (i === 2) continue; let x = i; } }');
    // body: [IF, 3, BOOL_EQ, READ_VALUE, 0, BYTE_1, 2, JUMP_2, 0, X, WRITE_VALUE, 1, READ_VALUE, 0] = 14
    // continue offset in body = 8
    // continue distance = 14 - 8 - 2 = 4
    // update: [WRITE_VALUE, 0, ADD, READ_VALUE, 0, BYTE_1, 1] = 7
    // cond: [BOOL_LT, READ_VALUE, 0, BYTE_1, 10] = 5
    // backCount = 14 + 7 + 2 + 5 + 2 = 30
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.IF,
        30,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.IF,
        3,
        OPS.BOOL_EQ,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        2,
        OPS.JUMP_2,
        0,
        4,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.WRITE_VALUE,
        0,
        OPS.ADD,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.IF,
        2,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.JUMP_BACK,
        30,
      ]),
    );
  });

  it('compiles for with i-- update', () => {
    const result = compile('function main() { for (let i = 10; i > 0; i--) { let x = i; } }');
    // update: [WRITE_VALUE, 0, SUB, READ_VALUE, 0, BYTE_1, 1] = 7
    // cond: [BOOL_GT, READ_VALUE, 0, BYTE_1, 0] = 5
    // body: [WRITE_VALUE, 1, READ_VALUE, 0] = 4
    // backCount = 4 + 7 + 2 + 5 + 2 = 20
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.IF,
        20,
        OPS.BOOL_GT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.WRITE_VALUE,
        0,
        OPS.SUB,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.IF,
        2,
        OPS.BOOL_GT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.JUMP_BACK,
        20,
      ]),
    );
  });

  it('compiles for with i += 2 update', () => {
    const result = compile('function main() { for (let i = 0; i < 10; i += 2) { let x = i; } }');
    // update: [WRITE_VALUE, 0, ADD, READ_VALUE, 0, BYTE_1, 2] = 7
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.IF,
        20,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.WRITE_VALUE,
        0,
        OPS.ADD,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        2,
        OPS.IF,
        2,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.JUMP_BACK,
        20,
      ]),
    );
  });

  it('compiles for with i = i * 2 update', () => {
    const result = compile('function main() { for (let i = 1; i < 100; i = i * 2) { let x = i; } }');
    // update: [WRITE_VALUE, 0, MUL, READ_VALUE, 0, BYTE_1, 2] = 7
    // cond: [BOOL_LT, READ_VALUE, 0, BYTE_1, 100] = 5
    // body: [WRITE_VALUE, 1, READ_VALUE, 0] = 4
    // backCount = 4 + 7 + 2 + 5 + 2 = 20
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.IF,
        20,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        100,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.WRITE_VALUE,
        0,
        OPS.MUL,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        2,
        OPS.IF,
        2,
        OPS.BOOL_LT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        100,
        OPS.JUMP_BACK,
        20,
      ]),
    );
  });

  it('compiles while with continue', () => {
    const result = compile('function main() { let x = 10; while (x > 0) { if (x === 5) continue; let y = x; } }');
    // cond: [BOOL_GT, READ_VALUE, 0, BYTE_1, 0] = 5
    // body: [IF, 3, BOOL_EQ, READ_VALUE, 0, BYTE_1, 5, JUMP_2, 0, X, WRITE_VALUE, 1, READ_VALUE, 0] = 14
    // continue offset = 8, continue distance = 14 - 8 - 2 = 4
    // backCount = 14 + 2 + 5 + 2 = 23
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.IF,
        23,
        OPS.BOOL_GT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.IF,
        3,
        OPS.BOOL_EQ,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.JUMP_2,
        0,
        4,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.IF,
        2,
        OPS.BOOL_GT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.JUMP_BACK,
        23,
      ]),
    );
  });

  it('compiles nested loops', () => {
    const result = compile(`function main() {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (j === 1) break;
        }
      }
    }`);
    // inner body: [IF, 3, BOOL_EQ, READ_VALUE, 1, BYTE_1, 1, JUMP_2, 0, X] = 10
    // inner update: [WRITE_VALUE, 1, ADD, READ_VALUE, 1, BYTE_1, 1] = 7
    // inner cond: [BOOL_LT, READ_VALUE, 1, BYTE_1, 3] = 5
    // inner backCount = 10 + 7 + 2 + 5 + 2 = 26
    // inner break offset = 8, break distance = 26 - 8 - 2 = 16
    // inner init: [WRITE_VALUE, 1, BYTE_1, 0] = 4
    // inner loop total: init(4) + IF(1) + skip(1) + cond(5) + body(10) + update(7) + IF(1) + skip(1) + cond(5) + JUMP_BACK(1) + count(1) = 37
    // outer body = inner init + inner loop = 4 + 33 = 37
    // outer update: [WRITE_VALUE, 0, ADD, READ_VALUE, 0, BYTE_1, 1] = 7
    // outer cond: [BOOL_LT, READ_VALUE, 0, BYTE_1, 3] = 5
    // outer backCount = 37 + 7 + 2 + 5 + 2 = 53
    const bytecode = result.bytecode[0];
    expect(bytecode[0]).toBe(OPS.ALLOCATE_VALUE);
    expect(bytecode[1]).toBe(2);
    expect(bytecode[bytecode.length - 1]).toBe(53);
    expect(bytecode[bytecode.length - 2]).toBe(OPS.JUMP_BACK);
  });

  it('throws on break outside loop', () => {
    expect(() => compile('function main() { break; }')).toThrow();
  });

  it('throws on continue outside loop', () => {
    expect(() => compile('function main() { continue; }')).toThrow();
  });
});
