/**
 * Cross-ENGINE parity smoke: the same SauceScript source compiled for both
 * targets must produce the same RESULT on both stacks — v1 through the
 * deployed Solidity interpreter (cast/anvil, cook()) and svm through the real
 * SVM engine (LiteSVM, svmCook()). Bytecode-level v12≡svm equality for pure
 * compute is unit-tested (svm-target.test.ts); this closes the loop at the
 * result level across engines.
 *
 * Runs against the vendored engine .so (canRunSvm; see svm-utils.ts) by
 * default, alongside the anvil/cast harness which is always up in a jest run
 * (global-setup) — both engines run in every CI job now.
 */
import { cook } from './utils.js';
import { canRunSvm, startSvm, svmCook, svmUint } from './svm-utils.js';
import type { SvmHarness } from './svm-utils.js';

const describeSvm = canRunSvm() ? describe : describe.skip;

describeSvm('integration: svm ↔ v1 result parity', () => {
  let h: SvmHarness;

  beforeAll(async () => {
    h = await startSvm();
  });

  const sources: { name: string; src: string }[] = [
    {
      name: 'nested function calls with params',
      src: 'function f(x) { return x + 1 }\nfunction g(x, y) { return x * y }\nfunction main() { return f(g(3, 4)) + g(f(1), 5) }',
    },
    {
      name: 'helper with locals called in a loop',
      src: 'function dbl(x) { const d = x + x; return d }\nfunction main() { let s = 0; for (let i = 1; i <= 4; i++) { s += dbl(i) } return s }',
    },
    {
      name: 'loop accumulation',
      src: 'function main() { let s = 0; for (let i = 0; i < 10; i++) { s += i * i } return s }',
    },
    {
      name: 'MUL_DIV rounding (truncates)',
      src: 'function main() { return Math.mulDiv(7, 3, 2) + Math.mulDiv(100, 100, 3) }',
    },
    {
      name: 'MUL_DIV full precision',
      src: 'function main() { return Math.mulDiv(2 ** 255, 6, 2 ** 254) }',
    },
    {
      name: 'string concat length',
      src: 'function main() { const a = "hello"; const b = " world"; return a.concat(b).length }',
    },
    {
      name: 'string char code after concat',
      src: 'function main() { const a = "ab"; const b = "cd"; const c = a.concat(b); return c[2] }',
    },
    {
      name: 'array index and set',
      src: 'function main() { let a = new Array(4); a[0] = 7; a[3] = 9; a[0] += a[3]; return a[0] * 10 + a.length }',
    },
    {
      name: 'array literal loop sum',
      src: 'function main() { const arr = [3, 7, 2, 9, 4]; let max = arr[0]; for (let i = 1; i < arr.length; i++) { if (arr[i] > max) { max = arr[i] } } return max }',
    },
    {
      name: 'abi round-trip',
      src: 'function main() { const d = abi.decode(abi.encode(11, 22, 33), "uint256", "uint256", "uint256"); return d[0] + d[1] * d[2] }',
    },
    {
      name: 'abi round-trip string length',
      src: 'function main() { const d = abi.decode(abi.encode("hello"), "string"); return d[0].length }',
    },
    {
      // Negatives are two's complement on both engines, but v1's Solidity
      // arithmetic is CHECKED — any op that wraps past 2^256 panics there. The
      // only cross-engine-comparable negative forms keep every intermediate in
      // range on v1: subtracting a more-negative value from a less-negative one.
      name: 'negative-number arithmetic (NEG encoding)',
      src: 'function main() { const a = -10; const b = -4; return (b - a) * 5 }',
    },
    {
      name: 'negative literals cancel via subtraction',
      src: 'function main() { const a = -3; const b = -9; return a - b }',
    },
    {
      name: 'comparison chain',
      src: 'function main() { let r = 0; if (1 < 2) { if (3 >= 3) { if (4 !== 5) { r = 7 } } } return r }',
    },
    {
      name: 'comparisons drive arithmetic through a ternary',
      src: 'function main() { let hi = 9 > 4 ? 9 : 4; let lo = 9 < 4 ? 9 : 4; return hi * 10 + lo }',
    },
    {
      name: 'tuple field mutation',
      src: 'function main() { let p = { x: 5, y: 9 }; p.x = p.y + 1; return p.x * 100 + p.y }',
    },
  ];

  for (const { name, src } of sources) {
    it(name, async () => {
      expect(svmUint(await svmCook(h, src))).toBe(BigInt(cook(src)));
    });
  }
});
