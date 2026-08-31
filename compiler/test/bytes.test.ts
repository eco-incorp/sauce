import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('bytes', () => {
  it('compiles new Uint8Array', () => {
    const result = compile('function main() { const b = new Uint8Array([1, 2, 3]); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.BYTES, 3, 1, 2, 3]),
    );
  });

  it('compiles Uint8Array.from', () => {
    const result = compile('function main() { const b = Uint8Array.from([0xff, 0x00, 0xab]); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.BYTES, 3, 0xff, 0x00, 0xab]),
    );
  });

  it('compiles empty Uint8Array', () => {
    const result = compile('function main() { const b = new Uint8Array([]); }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.BYTES, 0]));
  });

  it('throws for non-array argument', () => {
    expect(() => compile('function main() { const b = new Uint8Array(5); }')).toThrow(
      'Uint8Array expects an array literal',
    );
  });

  it('throws for invalid byte value', () => {
    expect(() => compile('function main() { const b = new Uint8Array([256]); }')).toThrow(
      'Uint8Array elements must be integers 0-255',
    );
  });

  it('throws for negative byte value', () => {
    expect(() => compile('function main() { const b = new Uint8Array([-1]); }')).toThrow(
      'Uint8Array elements must be number literals',
    );
  });

  it('compiles large Uint8Array with BYTES_2', () => {
    const elements = Array.from({ length: 256 }, (_, i) => i % 256).join(', ');
    const result = compile(`function main() { const b = new Uint8Array([${elements}]); }`);
    // Should use BYTES_2 (0x91) instead of BYTES (0x90)
    expect(result.bytecode[0][4]).toBe(OPS.BYTES_2);
    // Length is 256 = 0x0100 in big-endian
    expect(result.bytecode[0][5]).toBe(0x01);
    expect(result.bytecode[0][6]).toBe(0x00);
  });
});
