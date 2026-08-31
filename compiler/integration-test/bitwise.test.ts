import { cook } from './utils.js';

describe('integration: bitwise', () => {
  it('AND', () => {
    expect(BigInt(cook('function main() { return 0xff & 0x0f; }'))).toBe(0x0fn);
  });

  it('OR', () => {
    expect(BigInt(cook('function main() { return 0xf0 | 0x0f; }'))).toBe(0xffn);
  });

  it('XOR', () => {
    expect(BigInt(cook('function main() { return 0xff ^ 0x0f; }'))).toBe(0xf0n);
  });

  it('left shift', () => {
    expect(BigInt(cook('function main() { return 1 << 8; }'))).toBe(256n);
  });

  it('right shift', () => {
    expect(BigInt(cook('function main() { return 256 >> 4; }'))).toBe(16n);
  });

  it('NOT and mask', () => {
    expect(BigInt(cook('function main() { return ~0 & 0xff; }'))).toBe(0xffn);
  });

  it('shift round-trip', () => {
    expect(BigInt(cook('function main() { return (42 << 8) >> 8; }'))).toBe(42n);
  });

  it('combined: (a & b) | c', () => {
    expect(BigInt(cook('function main() { let a = 0xf0; let b = 0xff; let c = 0x0f; return (a & b) | c; }'))).toBe(
      0xffn,
    );
  });

  it('XOR self is zero', () => {
    expect(BigInt(cook('function main() { let x = 12345; return x ^ x; }'))).toBe(0n);
  });

  it('bit packing', () => {
    expect(BigInt(cook('function main() { let a = 1; let b = 2; let c = 3; return (a << 16) | (b << 8) | c; }'))).toBe(
      (1n << 16n) | (2n << 8n) | 3n,
    );
  });
});
