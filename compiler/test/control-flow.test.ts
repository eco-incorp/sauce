import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('control-flow', () => {
  it('compiles if statement', () => {
    // fold: false — the literal condition is const-foldable by default now; this pins
    // the pre-folding runtime-branch shape (see source-import.test.ts for the fold-on case).
    const result = compile('function main() { if (1 === 1) { const x = 5; } }', { fold: false });
    // thenBody = [WRITE_VALUE, 0, BYTE_1, 5] = 4 bytes
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.IF,
        4,
        OPS.BOOL_EQ,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        5,
      ]),
    );
  });

  it('compiles if-else statement', () => {
    // fold: false — see the 'compiles if statement' comment above.
    const result = compile('function main() { if (1 === 2) { const x = 5; } else { const y = 10; } }', {
      fold: false,
    });
    // thenBody = [WRITE_VALUE, 0, BYTE_1, 5] = 4 bytes
    // elseBody = [WRITE_VALUE, 1, BYTE_1, 10] = 4 bytes
    // IF skip = thenBody(4) + JUMP(1) + jumpOperand(1) = 6
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.IF,
        6,
        OPS.BOOL_EQ,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.JUMP,
        4,
        OPS.WRITE_VALUE,
        1,
        OPS.BYTE_1,
        10,
      ]),
    );
  });

  it('compiles if with variable reference', () => {
    const result = compile('function main() { const a = 1; if (a === 1) { const b = 2; } }');
    // thenBody = [WRITE_VALUE, 1, BYTE_1, 2] = 4 bytes
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.IF,
        4,
        OPS.BOOL_EQ,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        1,
        OPS.BYTE_1,
        2,
      ]),
    );
  });

  it('compiles else-if chain', () => {
    const result = compile(`function main() {
      const a = 1;
      if (a === 1) { const b = 10; }
      else if (a === 2) { const c = 20; }
      else { const d = 30; }
    }`);
    // thenBody1 = [WRITE_VALUE, 1, BYTE_1, 10] = 4 bytes
    // elseBody (contains nested if-else):
    //   IF, 6, BOOL_EQ, READ_VALUE, 0, BYTE_1, 2, WRITE_VALUE, 2, BYTE_1, 20, JUMP, 4, WRITE_VALUE, 3, BYTE_1, 30
    //   = 17 bytes
    // IF skip for outer = thenBody1(4) + JUMP(1) + jumpOperand(1) = 6
    // JUMP skip for outer = 17 (elseBody length)
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        4,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        1,
        // outer if
        OPS.IF,
        6,
        OPS.BOOL_EQ,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        1,
        OPS.BYTE_1,
        10,
        OPS.JUMP,
        17,
        // inner if (else-if)
        OPS.IF,
        6,
        OPS.BOOL_EQ,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        2,
        OPS.WRITE_VALUE,
        2,
        OPS.BYTE_1,
        20,
        OPS.JUMP,
        4,
        // else
        OPS.WRITE_VALUE,
        3,
        OPS.BYTE_1,
        30,
      ]),
    );
  });

  it('compiles ternary expression', () => {
    // fold: false — see the 'compiles if statement' comment above.
    const result = compile('function main() { const x = 1 === 1 ? 5 : 10; }', { fold: false });
    // IF skip=6 COND [WRITE_VALUE 0 5] JUMP 4 [WRITE_VALUE 0 10]
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.IF,
        6,
        OPS.BOOL_EQ,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.JUMP,
        4,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        10,
      ]),
    );
  });

  it('compiles ternary with variables', () => {
    const result = compile('function main() { const a = 3; const b = a > 1 ? a : 0; }');
    // IF skip=6 COND [WRITE_VALUE 1 a] JUMP 4 [WRITE_VALUE 1 0]
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        3,
        OPS.IF,
        6,
        OPS.BOOL_GT,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.JUMP,
        4,
        OPS.WRITE_VALUE,
        1,
        OPS.BYTE_1,
        0,
      ]),
    );
  });

  it('compiles throw with string', () => {
    const result = compile('function main() { throw "error"; }');
    // REVERT + BYTES "error" (5 chars)
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.REVERT, OPS.BYTES, 5, 0x65, 0x72, 0x72, 0x6f, 0x72]));
  });

  it('compiles throw with non-string argument', () => {
    // throw now supports arbitrary expressions (needed for throw abi.encode(...))
    const result = compile('function main() { throw abi.encode(42); }');
    const bytes = result.bytecode[0];
    expect(bytes).toContain(OPS.REVERT);
    expect(bytes).toContain(OPS.ABI_ENCODE);
  });

  it('compiles throw in conditional', () => {
    // fold: false — see the 'compiles if statement' comment above.
    const result = compile('function main() { if (1 === 0) { throw "fail"; } }', { fold: false });
    // 1 === 0 optimized to BOOL_ZERO check on 1
    // thenBody = [REVERT, BYTES, 4, "fail"] = 7 bytes
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.IF, 7, OPS.BOOL_ZERO, OPS.BYTE_1, 1, OPS.REVERT, OPS.BYTES, 4, 0x66, 0x61, 0x69, 0x6c]),
    );
  });
});
