import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('string', () => {
  it('compiles string literal', () => {
    const result = compile('function main() { const s = "hello"; }');
    // ALLOCATE_HEAP, 1, WRITE_HEAP, 0, BYTES, 5, h, e, l, l, o
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.BYTES, 5, 104, 101, 108, 108, 111]),
    );
  });

  it('compiles empty string', () => {
    const result = compile('function main() { const s = "";}');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.BYTES, 0]));
  });

  it('compiles unicode string', () => {
    const result = compile('function main() { const s = "中国";}');
    // UTF-8 encoding of 中国 is 6 bytes: e4 b8 ad e5 9b bd
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.BYTES, 6, 0xe4, 0xb8, 0xad, 0xe5, 0x9b, 0xbd]),
    );
  });

  it('compiles single-quoted string', () => {
    const result = compile("function main() { const s = 'hello'; }");
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.BYTES, 5, 104, 101, 108, 108, 111]),
    );
  });

  it('compiles long string with BYTES_2', () => {
    const longStr = 'a'.repeat(256);
    const result = compile(`function main() { const s = "${longStr}"; }`);
    // Should use BYTES_2 (0x91) instead of BYTES (0x90)
    expect(result.bytecode[0][4]).toBe(OPS.BYTES_2);
    // Length is 256 = 0x0100 in big-endian
    expect(result.bytecode[0][5]).toBe(0x01);
    expect(result.bytecode[0][6]).toBe(0x00);
  });
});
