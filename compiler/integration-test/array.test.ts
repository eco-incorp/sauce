import { cook } from './utils.js';

describe('integration: arrays', () => {
  it('array: index 0', () => {
    expect(BigInt(cook('function main() { const arr = [10, 20, 30]; const x = arr[0]; return x; }'))).toBe(10n);
  });

  it('array: index 1', () => {
    expect(BigInt(cook('function main() { const arr = [10, 20, 30]; const x = arr[1]; return x; }'))).toBe(20n);
  });

  it('array: index 2', () => {
    expect(BigInt(cook('function main() { const arr = [10, 20, 30]; const x = arr[2]; return x; }'))).toBe(30n);
  });

  it('array: larger values', () => {
    expect(BigInt(cook('function main() { const arr = [1000, 2000, 3000]; const x = arr[1]; return x; }'))).toBe(2000n);
  });

  it('array: bigint values', () => {
    expect(
      BigInt(
        cook(
          'function main() { const arr = [1000000000000000000n, 2000000000000000000n]; const x = arr[0]; return x; }',
        ),
      ),
    ).toBe(1000000000000000000n);
  });

  it('array: use indexed value in arithmetic', () => {
    expect(
      BigInt(cook('function main() { const arr = [5, 10, 15]; const x = arr[0] + arr[1] + arr[2]; return x; }')),
    ).toBe(30n);
  });

  it('array: sum with loop', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [1, 2, 3, 4, 5];
          let sum = 0;
          for (let i = 0; i < arr.length; i++) {
            sum = sum + arr[i];
          }
          return sum;
        }`,
        ),
      ),
    ).toBe(15n);
  });

  it('array: variable index', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [10, 20, 30];
          let i = 2;
          const x = arr[i];
          return x;
        }`,
        ),
      ),
    ).toBe(30n);
  });

  it('array: expression index', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [10, 20, 30];
          let i = 1;
          const x = arr[i + 1];
          return x;
        }`,
        ),
      ),
    ).toBe(30n);
  });

  it('array: length property', () => {
    expect(BigInt(cook('function main() { const arr = [1, 2, 3, 4, 5]; const len = arr.length; return len; }'))).toBe(
      5n,
    );
  });

  it('array: empty array length', () => {
    expect(BigInt(cook('function main() { const arr = []; const len = arr.length; return len; }'))).toBe(0n);
  });

  it('array: find max with loop', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [3, 7, 2, 9, 4];
          let max = arr[0];
          for (let i = 1; i < arr.length; i++) {
            if (arr[i] > max) {
              max = arr[i];
            }
          }
          return max;
        }`,
        ),
      ),
    ).toBe(9n);
  });

  it('array of strings: index first char of second string', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = ["hello", "world"];
          const s = arr[1];
          const c = s[0];
          return c;
        }`,
        ),
      ),
    ).toBe(119n); // 'w' = 119
  });

  it('2D array: access nested element', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [[10, 20], [30, 40]];
          const inner = arr[1];
          const x = inner[0];
          return x;
        }`,
        ),
      ),
    ).toBe(30n);
  });

  it('array of Uint8Array: access nested byte', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
          const inner = arr[0];
          const x = inner[2];
          return x;
        }`,
        ),
      ),
    ).toBe(3n);
  });

  it('3D array: access deeply nested element', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]];
          const layer1 = arr[1];
          const layer2 = layer1[0];
          const x = layer2[1];
          return x;
        }`,
        ),
      ),
    ).toBe(6n);
  });
});
