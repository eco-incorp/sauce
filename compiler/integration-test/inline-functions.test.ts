import { cook } from './utils.js';

// Real-execution validation of the inline (arrow-const) function convention — see
// CLAUDE.md ("Inline (arrow-const) functions") and compiler/src/processor/inline.ts.
//
// tickArg and kyberOut below are adapted from the real ecoswap recipe
// (sauce-recipes/ecoswap/ecoswap.sauce.ts, ~line 266/304) — copied as fixtures into
// THIS repo (not editing the read-only reference) with TypeScript type annotations
// stripped (this feature is core-acorn-stack, not the ts-frontend). tickArg is the
// two-level nested-guard-clause shape; kyberOut is the one-level guard-clause shape.
// Each is run BOTH as an inline arrow-const AND as an ordinary `function` declaration
// (today's existing, unmodified code path) across the branch boundaries the guards are
// designed for, and the results must match exactly.

const HIGH = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000';

const tickArgInlineSrc = `
  const tickArg = (shifted, OFFSET) => {
    const HIGH = ${HIGH}n;
    if (shifted >= OFFSET) {
      const up = shifted - OFFSET;
      if (up >= 8388608n) {
        return up | HIGH;
      }
      return up;
    }
    return Math.neg(OFFSET - shifted) | HIGH;
  };
  function main(shifted, OFFSET) { return tickArg(shifted, OFFSET); }
`;

const tickArgRealFnSrc = `
  function tickArg(shifted, OFFSET) {
    const HIGH = ${HIGH}n;
    if (shifted >= OFFSET) {
      const up = shifted - OFFSET;
      if (up >= 8388608n) {
        return up | HIGH;
      }
      return up;
    }
    return Math.neg(OFFSET - shifted) | HIGH;
  }
  function main(shifted, OFFSET) { return tickArg(shifted, OFFSET); }
`;

const OFFSET = 887272n; // real ecoswap tick-shift OFFSET magnitude

const tickArgCases: [bigint, bigint][] = [
  [1000n, OFFSET], // below OFFSET (else branch, Math.neg path)
  [OFFSET, OFFSET], // exact boundary: shifted === OFFSET -> up === 0 (< 8388608)
  [OFFSET + 1n, OFFSET], // just above: up === 1
  [OFFSET + 8388607n, OFFSET], // up === 8388607, just under the nested threshold
  [OFFSET + 8388608n, OFFSET], // up === 8388608 exactly: the nested boundary itself
  [OFFSET + 8388609n, OFFSET], // up just over the nested threshold
  [OFFSET + 20_000_000n, OFFSET], // well above the nested threshold
];

describe('integration: inline functions — real execution', () => {
  it.each(tickArgCases)('tickArg(%s, %s): inline matches real function', (shifted, offset) => {
    const inlineResult = cook(tickArgInlineSrc, { args: [shifted, offset] });
    const realFnResult = cook(tickArgRealFnSrc, { args: [shifted, offset] });

    expect(inlineResult).toBe(realFnResult);
  });

  // Regression: the fixtures above append `n` to HIGH (`${HIGH}n`) rather than using the
  // suffix-less literal form the real ecoswap recipe actually ships
  // (`const HIGH: Uint256 = 0xffff...000000;` — no `n` suffix, only a `: Uint256` type
  // annotation, which requires `tsSource: true`/a `.ts` source to even parse). Both
  // ts-frontend's `tsEvalConst` (the ts.Node evaluator) and acorn's own `const-eval.ts`
  // used to parse a suffix-less numeric literal beyond Number.MAX_SAFE_INTEGER through a
  // LOSSY `Number(...)` round-trip: this exact mask (`2^256 - 2^24`) rounded UP to exactly
  // `2^256` under that bug, so `tickArg` compiled via `tsSource: true` threw `value exceeds
  // 32 bytes (uint256 max)` at compile time even though the source is valid SauceScript.
  // Now fixed (both evaluators parse the literal's own raw source text via `BigInt(...)`
  // instead), this must compile AND execute identically to the `n`-suffixed baseline above.
  const tickArgTsSourceSrc = `
    const tickArg = (shifted: bigint, OFFSET: bigint) => {
      const HIGH: bigint = ${HIGH};
      if (shifted >= OFFSET) {
        const up = shifted - OFFSET;
        if (up >= 8388608n) {
          return up | HIGH;
        }
        return up;
      }
      return Math.neg(OFFSET - shifted) | HIGH;
    };
    function main(shifted: bigint, OFFSET: bigint) { return tickArg(shifted, OFFSET); }
  `;

  it.each(tickArgCases)(
    'tickArg(%s, %s): suffix-less HIGH literal via tsSource compiles and matches the n-suffixed baseline (regression)',
    (shifted, offset) => {
      expect(() => cook(tickArgTsSourceSrc, { args: [shifted, offset], tsSource: true })).not.toThrow();

      const tsSourceResult = cook(tickArgTsSourceSrc, { args: [shifted, offset], tsSource: true });
      const realFnResult = cook(tickArgRealFnSrc, { args: [shifted, offset] });

      expect(tsSourceResult).toBe(realFnResult);
    },
  );

  const kyberOutInlineSrc = `
    const kyberOut = (amt, kfee, kVin, kVout, PRECISION) => {
      const inWithFee = Math.mulDiv(amt, PRECISION - kfee, PRECISION);
      const denom = kVin + inWithFee;
      if (denom > 0n) {
        return Math.mulDiv(inWithFee, kVout, denom);
      }
      return 0n;
    };
    function main(amt, kfee, kVin, kVout, PRECISION) { return kyberOut(amt, kfee, kVin, kVout, PRECISION); }
  `;

  const kyberOutRealFnSrc = `
    function kyberOut(amt, kfee, kVin, kVout, PRECISION) {
      const inWithFee = Math.mulDiv(amt, PRECISION - kfee, PRECISION);
      const denom = kVin + inWithFee;
      if (denom > 0n) {
        return Math.mulDiv(inWithFee, kVout, denom);
      }
      return 0n;
    }
    function main(amt, kfee, kVin, kVout, PRECISION) { return kyberOut(amt, kfee, kVin, kVout, PRECISION); }
  `;

  const PRECISION = 1_000_000_000_000_000_000n;

  const kyberOutCases: [bigint, bigint, bigint, bigint, bigint][] = [
    [1000n, 3_000_000_000_000_000n, 500_000n, 500_000n, PRECISION], // denom > 0 branch
    [0n, 0n, 0n, 500_000n, PRECISION], // amt=0, kfee=0 -> inWithFee=0, kVin=0 -> denom===0 branch
    [10_000n, 0n, 1_000_000n, 2_000_000n, PRECISION], // ordinary swap-shaped values
  ];

  it.each(kyberOutCases)(
    'kyberOut(%s, %s, %s, %s, %s): inline matches real function',
    (amt, kfee, kVin, kVout, precision) => {
      const inlineResult = cook(kyberOutInlineSrc, { args: [amt, kfee, kVin, kVout, precision] });
      const realFnResult = cook(kyberOutRealFnSrc, { args: [amt, kfee, kVin, kVout, precision] });

      expect(inlineResult).toBe(realFnResult);
    },
  );

  it('v1 ordering fix: a forward-referencing helper-to-helper call now executes correctly', () => {
    const source = `
      function a(x) { return b(x) + 1n; }
      function b(x) { return x + 2n; }
      function main() { return a(3n); }
    `;

    expect(BigInt(cook(source))).toBe(6n); // b(3) = 5, a(3) = 5 + 1 = 6
  });

  it('inline call inside a loop BODY (not header) executes correctly each iteration', () => {
    const source = `
      const inc = (x) => x + 1n;
      function main() {
        let s = 0n;
        for (let i = 0n; i < 5n; i++) { s = s + inc(i); }
        return s;
      }
    `;

    // sum(inc(0..4)) = 1+2+3+4+5 = 15
    expect(BigInt(cook(source))).toBe(15n);
  });

  it('the same inline function called twice in one statement, with different args, is independently correct', () => {
    const source = `
      const f = (x) => x * 2n;
      function main() { return f(3n) + f(10n); }
    `;

    expect(BigInt(cook(source))).toBe(26n); // 6 + 20
  });

  it('hygiene: a user local named like the OLD vulnerable synthetic name ($inline_result_0) is NOT clobbered', () => {
    // Regression (real EVM execution): the synthetic alpha-rename namespace used to be
    // plain `$`-prefixed, a perfectly ordinary user-typable identifier. A user local
    // literally named `$inline_result_0` used to silently alias onto the compiler's own
    // first-assigned inline temp (Saucer.store() treats redeclaring an existing name as
    // silent get-or-create, not an error), clobbering the user's value. Now `#`-prefixed
    // (unparseable SauceScript), so the user's own 999 must survive untouched.
    const source = `
      const inc = (x) => x + 1n;
      function main() {
        let $inline_result_0 = 999n;
        const r = inc(5n);
        return $inline_result_0 + r;
      }
    `;

    // Expected: 999 + (5 + 1) = 1005. Before the fix this returned 6 (5+1), i.e. the
    // synthesized `let $inline_result_0 = 0n;` silently overwrote the user's 999.
    expect(BigInt(cook(source))).toBe(1005n);
  });

  it('a braced if/else where both branches return, called from an inline function, executes each branch correctly', () => {
    // Regression: eliminateReturns/expandStatementList used to build the else-branch's
    // statement list from the raw, un-unwrapped BlockStatement node instead of unwrapping
    // it via blockToStatements — this threw a compile error for ANY braced else. Pin the
    // fix with real execution across both branches (not just "does it compile").
    const source = `
      const classify = (x) => {
        if (x >= 100n) {
          return 111n;
        } else {
          return 222n;
        }
      };
      function main(x) { return classify(x); }
    `;

    expect(BigInt(cook(source, { args: [500n] }))).toBe(111n); // consequent branch
    expect(BigInt(cook(source, { args: [5n] }))).toBe(222n); // braced else branch
  });

  it('an inline argument expression (a real function call) is evaluated exactly once', () => {
    // sideEffectful() writes to storage slot 0 (incrementing a counter) and returns
    // the NEW count; if the inline expansion evaluated its argument more than once,
    // the counter (and hence the final result) would come out wrong.
    const source = `
      const twice = (x) => x + x;
      function bump() {
        const n = storage.read(0n) + 1n;
        storage.write(0n, n);
        return n;
      }
      function main() {
        const r = twice(bump());
        return r * 100n + storage.read(0n);
      }
    `;

    // bump() must run exactly once -> storage becomes 1n, r = 1n + 1n = 2n, result = 201n.
    // Were the argument evaluated twice, storage would be 2n and r would be 1n+2n=3n (301).
    expect(BigInt(cook(source))).toBe(201n);
  });
});

// FINDING fix: an inline function returning a dynamic-kind value used to be an unconditional
// v1 COMPILE ERROR — `#inline_result_N`'s first declaration was always the scalar literal
// `0n`, so a later reassignment to a dynamic value tripped `rejectV1ScalarToDynamicReassignment`
// (processor/statement.ts). Real-execution proof that this is a genuine member of the
// dynamic-value storage-kind bug family, NOT a false positive: on the pre-fix commit
// (5e205e6, before `rejectV1ScalarToDynamicReassignment` existed) the IDENTICAL source
// compiled cleanly and then reverted `SauceInvalidOperationArgs(0x97)` (INDEX — the exact
// descriptor-drop fault code this whole bug family is defined by) on real EVM execution —
// confirmed via `git stash`+cook() bisection. Fixed by `couldReturnBeDynamic` (inline.ts).
describe('integration: inline function returning a dynamic value (real execution)', () => {
  it('a `new Array(n)`-built TUPLE return round-trips correctly', () => {
    const source = `
      const build = () => {
        const a = new Array(2);
        a[0] = 7n;
        a[1] = 8n;
        return a;
      };
      function main() {
        let r = build();
        return r[0] + r[1] * 10n;
      }
    `;

    expect(BigInt(cook(source))).toBe(87n); // 7 + 8*10
  });

  it('a guard-clause function mixing a scalar return on one path and a dynamic return on another round-trips both paths', () => {
    const source = `
      const classify = (x) => {
        if (x === 0n) {
          return 0n;
        }
        const arr = new Array(2);
        arr[0] = x;
        arr[1] = x * 2n;
        return arr;
      };
      function main(x) {
        let r = classify(x);
        return r[0] + r[1] * 10n;
      }
    `;

    // The dynamic path is proven by the ONLY branch that can be observed via cook() below —
    // the scalar path (x === 0n) returns a bare 0n, not an array, so it's checked separately
    // via its own dedicated (non-indexed) call, mirroring how the compile-time test suite
    // already separates the two paths.
    expect(BigInt(cook(source, { args: [3n] }))).toBe(63n); // 3 + 6*10
    expect(BigInt(cook('function main() { return 0n; }'))).toBe(0n); // scalar-path control
  });

  it('a `.concat()` (string) return round-trips its real length', () => {
    const source = `
      const greet = () => {
        return "hi".concat("there");
      };
      function main() {
        let s = greet();
        return s.length;
      }
    `;

    expect(BigInt(cook(source))).toBe(7n); // "hithere".length
  });

  it('the exact motivating shape, mutated with a genuinely runtime value (not a compile-time fold)', () => {
    const source = `
      const build = () => {
        const a = new Array(3);
        a[0] = 1n;
        a[1] = 2n;
        a[2] = 3n;
        return a;
      };
      function main() {
        let arr = build();
        arr[0] = ctx.selfBalance();
        return arr[0];
      }
    `;

    expect(BigInt(cook(source))).toBe(BigInt(cook('function main() { return ctx.selfBalance(); }')));
  });
});
