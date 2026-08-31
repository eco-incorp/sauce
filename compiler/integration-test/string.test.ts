import { cook } from './utils.js';

describe('integration: strings and bytes', () => {
  it('string: index 0 returns first char code', () => {
    // 'a' = 97
    expect(BigInt(cook('function main() { const s = "abc"; const x = s[0]; return x; }'))).toBe(97n);
  });

  it('string: index 1 returns second char code', () => {
    // 'b' = 98
    expect(BigInt(cook('function main() { const s = "abc"; const x = s[1]; return x; }'))).toBe(98n);
  });

  it('string: index 2 returns third char code', () => {
    // 'c' = 99
    expect(BigInt(cook('function main() { const s = "abc"; const x = s[2]; return x; }'))).toBe(99n);
  });

  it('Uint8Array: index 0', () => {
    expect(
      BigInt(cook('function main() { const b = new Uint8Array([0xff, 0x42, 0x00]); const x = b[0]; return x; }')),
    ).toBe(255n);
  });

  it('Uint8Array: index 1', () => {
    expect(
      BigInt(cook('function main() { const b = new Uint8Array([0xff, 0x42, 0x00]); const x = b[1]; return x; }')),
    ).toBe(66n);
  });

  it('Uint8Array.from: index 0', () => {
    expect(
      BigInt(cook('function main() { const b = Uint8Array.from([100, 200, 50]); const x = b[0]; return x; }')),
    ).toBe(100n);
  });

  it('bytes: sum of bytes', () => {
    expect(
      BigInt(
        cook('function main() { const b = new Uint8Array([10, 20, 30]); const x = b[0] + b[1] + b[2]; return x; }'),
      ),
    ).toBe(60n);
  });

  it('string: length property', () => {
    expect(BigInt(cook('function main() { const s = "hello"; const len = s.length; return len; }'))).toBe(5n);
  });

  it('string: empty string length', () => {
    expect(BigInt(cook('function main() { const s = ""; const len = s.length; return len; }'))).toBe(0n);
  });

  it('bytes: length property', () => {
    expect(
      BigInt(cook('function main() { const b = new Uint8Array([1, 2, 3, 4]); const len = b.length; return len; }')),
    ).toBe(4n);
  });

  it('string: variable index', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = "abc";
          let i = 2;
          const c = s[i];
          return c;
        }`,
        ),
      ),
    ).toBe(99n); // 'c' = 99
  });

  it('bytes: variable index', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const b = new Uint8Array([10, 20, 30]);
          let i = 1;
          const x = b[i];
          return x;
        }`,
        ),
      ),
    ).toBe(20n);
  });

  it('string: sum char codes with loop', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = "abc";
          let sum = 0;
          for (let i = 0; i < s.length; i++) {
            sum = sum + s[i];
          }
          return sum;
        }`,
        ),
      ),
    ).toBe(294n); // 97 + 98 + 99 = 294
  });

  it('bytes: sum with loop', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const b = new Uint8Array([10, 20, 30, 40]);
          let sum = 0;
          for (let i = 0; i < b.length; i++) {
            sum = sum + b[i];
          }
          return sum;
        }`,
        ),
      ),
    ).toBe(100n);
  });
});
