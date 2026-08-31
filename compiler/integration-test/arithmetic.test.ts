import { cook } from './utils.js';

describe('integration: arithmetic', () => {
  it('addition', () => {
    expect(BigInt(cook('function main() { return 100 + 200; }'))).toBe(300n);
  });

  it('subtraction', () => {
    expect(BigInt(cook('function main() { return 500 - 123; }'))).toBe(377n);
  });

  it('multiplication', () => {
    expect(BigInt(cook('function main() { return 7 * 13; }'))).toBe(91n);
  });

  it('division', () => {
    expect(BigInt(cook('function main() { return 100 / 3; }'))).toBe(33n);
  });

  it('modulo', () => {
    expect(BigInt(cook('function main() { return 100 % 3; }'))).toBe(1n);
  });

  it('exponentiation', () => {
    expect(BigInt(cook('function main() { return 2 ** 10; }'))).toBe(1024n);
  });

  it('sqrt', () => {
    expect(BigInt(cook('function main() { return Math.sqrt(144); }'))).toBe(12n);
  });

  it('sqrt truncates', () => {
    expect(BigInt(cook('function main() { return Math.sqrt(10); }'))).toBe(3n);
  });

  it('mulDiv', () => {
    expect(BigInt(cook('function main() { return Math.mulDiv(100, 50, 25); }'))).toBe(200n);
  });

  it('mulDiv full precision (no intermediate overflow)', () => {
    expect(BigInt(cook('function main() { return Math.mulDiv(2 ** 255, 2, 2 ** 255); }'))).toBe(2n);
  });

  it('nested: (a + b) * c', () => {
    expect(BigInt(cook('function main() { return (3 + 4) * 5; }'))).toBe(35n);
  });

  it('operator precedence: a + b * c', () => {
    expect(BigInt(cook('function main() { return 3 + 4 * 5; }'))).toBe(23n);
  });

  it('large multiplication', () => {
    expect(BigInt(cook('function main() { return 1000000 * 1000000; }'))).toBe(1000000000000n);
  });

  it('chained operations with variables', () => {
    expect(BigInt(cook('function main() { let a = 10; let b = 20; let c = 30; return a * b + c; }'))).toBe(230n);
  });

  it('division then modulo', () => {
    expect(BigInt(cook('function main() { return (17 / 5) * 5 + 17 % 5; }'))).toBe(17n);
  });
});
