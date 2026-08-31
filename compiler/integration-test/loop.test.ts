import { cook } from './utils.js';

describe('integration: loops', () => {
  it('for loop: sum 0 to 9 = 45', () => {
    expect(
      BigInt(cook('function main() { let sum = 0; for (let i = 0; i < 10; i++) { sum = sum + i; } return sum; }')),
    ).toBe(45n);
  });

  it('for loop: zero iterations preserves initial value', () => {
    expect(
      BigInt(cook('function main() { let sum = 99; for (let i = 10; i < 5; i++) { sum = 0; } return sum; }')),
    ).toBe(99n);
  });

  it('while loop: countdown to 0', () => {
    expect(BigInt(cook('function main() { let i = 10; while (i > 0) { i--; } return i; }'))).toBe(0n);
  });

  it('for loop: break at 5, sum = 10', () => {
    expect(
      BigInt(
        cook(
          'function main() { let sum = 0; for (let i = 0; i < 10; i++) { if (i === 5) break; sum = sum + i; } return sum; }',
        ),
      ),
    ).toBe(10n);
  });

  it('for loop: continue at 2, sum = 8', () => {
    expect(
      BigInt(
        cook(
          'function main() { let sum = 0; for (let i = 0; i < 5; i++) { if (i === 2) continue; sum = sum + i; } return sum; }',
        ),
      ),
    ).toBe(8n);
  });

  it('nested for loops: 3 * 4 = 12', () => {
    expect(
      BigInt(
        cook(
          'function main() { let sum = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 4; j++) { sum = sum + 1; } } return sum; }',
        ),
      ),
    ).toBe(12n);
  });

  it('while true: break at 10', () => {
    expect(BigInt(cook('function main() { let i = 0; while (true) { if (i === 10) break; i++; } return i; }'))).toBe(
      10n,
    );
  });

  it('for loop: compound assignment sum += i', () => {
    expect(BigInt(cook('function main() { let sum = 0; for (let i = 0; i < 5; i++) { sum += i; } return sum; }'))).toBe(
      10n,
    );
  });

  it('infinite for: break at 5', () => {
    expect(BigInt(cook('function main() { let x = 0; for (;;) { x = x + 1; if (x === 5) break; } return x; }'))).toBe(
      5n,
    );
  });
});
