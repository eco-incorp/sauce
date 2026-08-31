import { cook } from './utils.js';

describe('integration: functions', () => {
  it('basic function returning a constant', () => {
    expect(BigInt(cook('function five() { return 5; }\nfunction main() { return five(); }'))).toBe(5n);
  });

  it('function with parameters', () => {
    expect(BigInt(cook('function add(a, b) { return a + b; }\nfunction main() { return add(3, 7); }'))).toBe(10n);
  });

  it('function with local variable', () => {
    expect(
      BigInt(
        cook('function square(x) { const result = x * x; return result; }\nfunction main() { return square(6); }'),
      ),
    ).toBe(36n);
  });

  it('nested function calls', () => {
    expect(
      BigInt(
        cook(
          'function double(x) { return x + x; }\nfunction add(a, b) { return a + b; }\nfunction main() { return add(double(3), double(4)); }',
        ),
      ),
    ).toBe(14n);
  });

  it('function result used in arithmetic', () => {
    expect(BigInt(cook('function ten() { return 10; }\nfunction main() { return ten() * 3 + 1; }'))).toBe(31n);
  });

  it('multiple functions combined', () => {
    expect(
      BigInt(
        cook(
          'function foo() { return 100; }\nfunction bar() { return 23; }\nfunction main() { return foo() + bar(); }',
        ),
      ),
    ).toBe(123n);
  });

  it('function result stored and reused', () => {
    expect(
      BigInt(
        cook(
          'function double(x) { return x + x; }\nfunction main() { let a = double(5); let b = double(a); return b; }',
        ),
      ),
    ).toBe(20n);
  });

  it('function result in if condition', () => {
    expect(
      BigInt(
        cook(
          'function isSmall(x) { if (x < 10) { return 1; } else { return 0; } }\nfunction main() { let r = 0; if (isSmall(5) === 1) { r = 99; } return r; }',
        ),
      ),
    ).toBe(99n);
  });

  it('function called inside a loop', () => {
    expect(
      BigInt(
        cook(
          'function double(x) { return x + x; }\nfunction main() { let sum = 0; for (let i = 1; i <= 4; i++) { sum += double(i); } return sum; }',
        ),
      ),
    ).toBe(20n);
  });

  it('function with conditional return: first branch', () => {
    expect(
      BigInt(
        cook(
          'function max(a, b) { if (a > b) { return a; } else { return b; } }\nfunction main() { return max(42, 17); }',
        ),
      ),
    ).toBe(42n);
  });

  it('function with conditional return: second branch', () => {
    expect(
      BigInt(
        cook(
          'function max(a, b) { if (a > b) { return a; } else { return b; } }\nfunction main() { return max(3, 50); }',
        ),
      ),
    ).toBe(50n);
  });

  it('function defined after main', () => {
    expect(BigInt(cook('function main() { return helper(); }\nfunction helper() { return 77; }'))).toBe(77n);
  });

  it('early return: if without else', () => {
    expect(
      BigInt(
        cook('function max(a, b) { if (a > b) { return a; } return b; }\nfunction main() { return max(42, 17); }'),
      ),
    ).toBe(42n);
  });

  it('early return: fallthrough', () => {
    expect(
      BigInt(cook('function max(a, b) { if (a > b) { return a; } return b; }\nfunction main() { return max(3, 50); }')),
    ).toBe(50n);
  });

  it('early return: chained ifs', () => {
    expect(
      BigInt(
        cook(
          'function classify(x) { if (x > 100) { return 3; } if (x > 10) { return 2; } return 1; }\nfunction main() { return classify(50); }',
        ),
      ),
    ).toBe(2n);
  });

  it('early return: first chained if', () => {
    expect(
      BigInt(
        cook(
          'function classify(x) { if (x > 100) { return 3; } if (x > 10) { return 2; } return 1; }\nfunction main() { return classify(200); }',
        ),
      ),
    ).toBe(3n);
  });

  it('early return: fallthrough all ifs', () => {
    expect(
      BigInt(
        cook(
          'function classify(x) { if (x > 100) { return 3; } if (x > 10) { return 2; } return 1; }\nfunction main() { return classify(5); }',
        ),
      ),
    ).toBe(1n);
  });

  it('early return in loop', () => {
    expect(
      BigInt(
        cook(
          'function findFirst(n) { for (let i = 1; i <= n; i++) { if (i * i > 50) { return i; } } return 0; }\nfunction main() { return findFirst(100); }',
        ),
      ),
    ).toBe(8n);
  });
});
