import { cook } from './utils.js';

describe('integration: concat', () => {
  it('array concat: read element', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [10, 20];
          const b = [30, 40];
          const c = a.concat(b);
          const x = c[2];
          return x;
        }`,
        ),
      ),
    ).toBe(30n);
  });

  it('array concat: length', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [1, 2, 3];
          const b = [4, 5];
          const c = a.concat(b);
          const x = c.length;
          return x;
        }`,
        ),
      ),
    ).toBe(5n);
  });

  it('array concat: multi-operand', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [1];
          const b = [2];
          const c = [3];
          const d = a.concat(b, c);
          const x = d[2];
          return x;
        }`,
        ),
      ),
    ).toBe(3n);
  });

  it('string concat: length', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = "hello";
          const b = " world";
          const c = a.concat(b);
          const x = c.length;
          return x;
        }`,
        ),
      ),
    ).toBe(11n);
  });

  it('string concat: read char', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = "ab";
          const b = "cd";
          const c = a.concat(b);
          const x = c[3];
          return x;
        }`,
        ),
      ),
    ).toBe(100n); // 'd' = 100
  });

  it('bytes concat: length', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = Uint8Array.from([0xaa, 0xbb]);
          const b = Uint8Array.from([0xcc]);
          const c = a.concat(b);
          const x = c.length;
          return x;
        }`,
        ),
      ),
    ).toBe(3n);
  });

  it('bytes concat: read byte', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = Uint8Array.from([0xaa, 0xbb]);
          const b = Uint8Array.from([0xcc, 0xdd]);
          const c = a.concat(b);
          const x = c[2];
          return x;
        }`,
        ),
      ),
    ).toBe(0xccn);
  });

  it('struct concat: read field', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [{ x: 1, y: 2 }];
          const b = [{ x: 3, y: 4 }];
          const c = a.concat(b);
          const elem = c[1];
          const x = elem.x;
          return x;
        }`,
        ),
      ),
    ).toBe(3n);
  });
});

describe('integration: slice', () => {
  it('array slice: read element', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [10, 20, 30, 40, 50];
          const b = a.slice(1, 4);
          const x = b[0];
          return x;
        }`,
        ),
      ),
    ).toBe(20n);
  });

  it('array slice: length', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [10, 20, 30, 40, 50];
          const b = a.slice(1, 4);
          const x = b.length;
          return x;
        }`,
        ),
      ),
    ).toBe(3n);
  });

  it('array slice: last element', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [10, 20, 30, 40, 50];
          const b = a.slice(2, 5);
          const x = b[2];
          return x;
        }`,
        ),
      ),
    ).toBe(50n);
  });

  it('string slice: length', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = "hello world";
          const b = a.slice(0, 5);
          const x = b.length;
          return x;
        }`,
        ),
      ),
    ).toBe(5n);
  });

  it('string slice: read char', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = "abcdef";
          const b = a.slice(2, 5);
          const x = b[0];
          return x;
        }`,
        ),
      ),
    ).toBe(99n); // 'c' = 99
  });

  it('bytes slice: read byte', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
          const b = a.slice(1, 3);
          const x = b[1];
          return x;
        }`,
        ),
      ),
    ).toBe(0xben);
  });

  it('struct slice: read field', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }];
          const b = a.slice(1, 3);
          const elem = b[0];
          const x = elem.y;
          return x;
        }`,
        ),
      ),
    ).toBe(40n);
  });

  it('slice with variable indices', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = [100, 200, 300, 400, 500];
          let start = 2;
          let end = 4;
          const b = a.slice(start, end);
          return b[1];
        }`,
        ),
      ),
    ).toBe(400n);
  });
});
