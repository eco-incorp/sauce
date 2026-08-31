import { compile, type CompileTarget, clearDefaultCompileCache } from '../src/index.js';
import { tsPartialEval, tsPartialEvalWithMeta } from '../src/ts-frontend.js';
import { OPS } from '../src/saucer/ops.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// The built-in fold+strip front-end (compiler/src/ts-frontend.ts), scoped to `.ts`/
// `.sauce.ts` sources/imports only. A plain `.js`/`.sauce` module never invokes it. Three
// groups: (1) direct unit tests of `tsPartialEval` as a pure string→string function — the
// right level to exercise fold shapes acorn's hand-rolled const-eval.ts can't
// (ConditionalExpression has no case there at all) without fighting SauceScript's OWN
// separate restrictions (e.g. a ternary may only appear in assignment position); (2) loop
// unrolling; (3) integration tests through the real `compile()` pipeline, proving the wiring.
//
// IMPORTANT (found while writing these tests): ts-evaluator@2.0.0 has a real bug —
// `BigInt(node.text)` on a bare BigIntLiteral throws (`node.text` is "3n", including the
// literal's own "n" suffix, which the BigInt() *constructor* rejects) — and separately,
// it cannot evaluate bigint BINARY expressions, array/property access, or function calls
// at all without a full ts.Program/TypeChecker (out of scope here). Since SauceScript is
// bigint-only, ts-frontend.ts's PRIMARY evaluator is `tsEvalConst`, a hand-rolled bigint
// evaluator (mirrors processor/const-eval.ts, retargeted to ts.Node) — ts-evaluator is only
// a fallback for shapes it doesn't cover (bare boolean/string identifiers, ternaries,
// templates). `tryEvaluate` still wraps ts-evaluator's `evaluate()` in try/catch for
// whatever still reaches it (a template literal with a bigint substitution, e.g.) — see the
// dedicated regression tests below.

describe('tsPartialEval (direct unit tests)', () => {
  it('strips TS-only syntax (type annotations)', () => {
    const out = tsPartialEval(`function f(n: bigint): bigint { return n; }`, 'f.ts');

    expect(out).not.toContain('bigint');
    expect(out).toContain('function f(n)');
  });

  it('folds a dead if/else branch gated on a same-file const identifier', () => {
    const code = `
      const FLAG = true;
      function f() {
        if (FLAG) { return 1; } else { return 2; }
      }
    `;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('return 1');
    expect(out).not.toContain('return 2');
  });

  it("folds a ternary used as a value — a ConditionalExpression, a node kind acorn's const-eval.ts has no case for at all", () => {
    const out = tsPartialEval(`const FLAG = true;\nconst x = FLAG ? 1 : 2;`, 'f.ts');

    expect(out).toContain('const x = 1');
    expect(out).not.toContain('? 1 : 2');
  });

  it('folds literal binary arithmetic to a single literal', () => {
    // `let`, not `const`: isFoldableValueExpression's literal-arithmetic fold doesn't care
    // about declaration kind (it's a purely syntactic check on the initializer shape). A bare
    // `let y = 2 + 3;` alone would ALSO now be picked up by effectively-const `let`/`var`
    // detection (see the dedicated describe block below) and fully eliminated once `y` has
    // zero remaining reads — so this fixture adds one further reassignment purely to
    // disqualify `y` from that (unrelated) feature and keep this test isolated to ONLY the
    // literal-arithmetic fold it's meant to pin.
    const out = tsPartialEval(`let y = 2 + 3;\ny = 10;`, 'f.ts');

    expect(out).toContain('let y = 5');
    expect(out).toContain('y = 10;');
    expect(out).not.toContain('2 + 3');
  });

  it('folds a bare BigInt-literal condition — tsEvalConst resolves it directly, ts-evaluator never sees it', () => {
    const code = `
      function f() {
        if (1n) { return 1n; } else { return 2n; }
      }
    `;

    // ts-evaluator@2.0.0 would throw on this (BigInt(node.text) rejects the literal's own
    // "n" suffix) — but tsEvalConst handles BigIntLiteral directly and never delegates to
    // it for this shape, so it folds correctly instead of merely failing closed.
    expect(() => tsPartialEval(code, 'f.ts')).not.toThrow();
    const out = tsPartialEval(code, 'f.ts');
    expect(out).toContain('return 1n');
    expect(out).not.toContain('return 2n');
  });

  it('still fails closed (no throw) when a bigint reaches ts-evaluator itself — e.g. inside a template literal', () => {
    // tsEvalConst has no TemplateExpression case, so this falls through to the
    // ts-evaluator fallback with a bigint substitution present — the shape that would
    // otherwise hit ts-evaluator@2.0.0's BigInt(node.text) crash. tryEvaluate's try/catch
    // must still guard this regardless of what tsEvalConst itself now covers.
    const code = 'const x = `val:${1n}`;';

    expect(() => tsPartialEval(code, 'f.ts')).not.toThrow();
  });

  it('fails closed (no throw) on a runtime-derived (parameter) condition', () => {
    const code = `function f(n) { if (n === 1) { return 1; } return 2; }`;

    expect(() => tsPartialEval(code, 'f.ts')).not.toThrow();
    const out = tsPartialEval(code, 'f.ts');
    expect(out).toContain('return 1');
    expect(out).toContain('return 2');
  });

  it('never folds a bare assignment expression — ts-evaluator "succeeds" on `a = 1` (returns 1), which would silently discard the mutation', () => {
    // Regression: `evaluate({node: <the "a = 1" BinaryExpression>})` returns success:true,
    // value:1 — the assignment's own left-hand mutation is invisible to that "value". Before
    // the fix, isFoldableValueExpression's fold path replaced `a = 1;` with bare `1;`,
    // silently dropping the assignment to `a` entirely. `a` is reassigned TWICE here (not
    // once) so effectively-const `let`/`var` detection (see the dedicated describe block
    // below) never touches this fixture at all — this test is isolated to ONLY the
    // assignment-is-never-a-foldable-value guard it's meant to pin; the ORIGINAL
    // single-assignment shape from this same code now has its own (very different, and now
    // fully collapsing) coverage there.
    const code = `let a;\na = 1;\na = 2;\nconsole.log(a);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('a = 1;');
    expect(out).toContain('a = 2;');
    expect(out).not.toMatch(/^\s*1;/m);
  });

  it('never folds an assignment used as an if/ternary condition (the classic footgun pattern)', () => {
    const code = `let a;\nif (a = 1) { console.log('yes'); }\nconsole.log(a);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('a = 1');
    expect(out).toContain('if (');
  });

  it('never folds a compound assignment (+=) expression', () => {
    const code = `let x = 0;\nx += 5;\nconsole.log(x);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('x += 5;');
  });

  describe('numeric literal precision (tsEvalConst)', () => {
    // Regression: `ts.NumericLiteral.text` is NOT the literal's raw source text — the TS
    // scanner normalizes it through a lossy JS-`number` round-trip (confirmed: a suffix-less
    // hex/decimal literal beyond Number.MAX_SAFE_INTEGER comes back from `.text` as e.g.
    // "1.157920892373162e+77", already wrong). `tsEvalConst`'s `ts.isNumericLiteral` branch
    // used to fold via `Number(node.text)`, silently corrupting any such literal used as a
    // top-level const, an effectively-const let/var, a function-local constant-propagated
    // value, or a loop bound. Now parses `node.getText()` (the literal exactly as written)
    // through `BigInt(...)` instead.
    it('folds a huge suffix-less HEX literal (beyond Number.MAX_SAFE_INTEGER) to its EXACT value', () => {
      // The real ecoswap `HIGH` mask (sauce-recipes/ecoswap/ecoswap.sauce.ts ~line 267):
      // 2^256 - 2^24, legally in-range for uint256. Under the lossy-Number bug this rounded
      // UP to exactly 2^256 (one past uint256 max).
      const trueValue = 2n ** 256n - 2n ** 24n;
      const out = tsPartialEval(`const HIGH = ${'0x' + trueValue.toString(16)};\nconsole.log(HIGH);`, 'f.ts');

      expect(out).toContain(`console.log(${trueValue.toString()}n)`);
    });

    it('folds a huge suffix-less DECIMAL literal (beyond Number.MAX_SAFE_INTEGER) to its EXACT value', () => {
      // Deliberately NOT a round power of 2 so a lossy Number round-trip is observable (it
      // would drop the `+ 12345` entirely).
      const trueValue = 2n ** 200n + 12345n;
      const out = tsPartialEval(`const X = ${trueValue.toString()};\nconsole.log(X);`, 'f.ts');

      expect(out).toContain(`console.log(${trueValue.toString()}n)`);
    });

    it('still folds an ordinary small numeric literal (unaffected by the fix)', () => {
      const out = tsPartialEval(`const X = 42;\nconsole.log(X);`, 'f.ts');

      expect(out).toContain('console.log(42n)');
    });

    it('still folds a literal with numeric separators', () => {
      const out = tsPartialEval(`const X = 1_000_000;\nconsole.log(X);`, 'f.ts');

      expect(out).toContain('console.log(1000000n)');
    });

    it('still fails closed (does not fold, does not throw) on a non-integer literal — a floating-point value', () => {
      // Not foldable, so `X` is never registered as a compile-time constant: neither the
      // read (`console.log(X)`) nor the declaration itself is touched at all.
      const code = `const X = 1.5;\nconsole.log(X);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const X = 1.5;');
      expect(out).toContain('console.log(X);');
    });

    it('still fails closed (does not fold, does not throw) on a non-integer literal — exponential notation', () => {
      // Number.isInteger(1e21) is true (it's a whole-number-VALUED float) but BigInt("1e21")
      // throws — correctly declining to fold rather than silently computing a rounded value
      // the way the old Number(node.text) + Number.isInteger check would have.
      const code = `const X = 1e21;\nconsole.log(X);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const X = 1e21;');
      expect(out).toContain('console.log(X);');
    });
  });
});

describe('tsPartialEval (if-branch flattening — collision with a surrounding declaration)', () => {
  // Regression: `foldTransformer`'s if-statement branch-flattening splices a taken
  // `if (true) { ... }` / `if (false) { ... } else { ... }` branch's OWN statements directly
  // into the enclosing statement list (Block.statements/SourceFile.statements) — the
  // identical root-cause shape (splicing into an enclosing scope without checking for a name
  // collision) as the loop-unroll crash `collidesWithSurroundingDeclarations` was added for,
  // but in this separate code path. Before this fix, a taken branch's OWN `let`/`const` of
  // the SAME name as something already declared in the enclosing scope (an entirely ordinary
  // shape) produced two adjacent declarations of that name in the SAME flattened scope —
  // `ts.transpileModule`'s printer happily printed that text, but `acorn.parse` (the very
  // next compile() stage) then threw `SyntaxError: Identifier 'x' has already been declared`.
  it('bails (leaves the if as real runtime code) when the taken branch redeclares an OUTER already-declared name', () => {
    // Wrapped in a function: a bare top-level (SourceFile-level) statement list never
    // reserves its OWN sibling declarations into `shadowed` (a separate, pre-existing,
    // deliberate asymmetry vs. a function/block's own body scan — see the loop-unroll
    // collision tests above for the same requirement), so the collision guard needs an
    // enclosing FUNCTION scope to see the outer `let x` as already-declared.
    const code = `function f() {\n  let x = 1n;\n  if (true) {\n    let x = 2n;\n    x = x + 1n;\n  }\n  console.log(x);\n}`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('if ('); // NOT flattened — the collision guard declined
  });

  it('the same collision shape via the compile() pipeline compiles without throwing (real repro, end to end)', () => {
    const source = `function main() {
      let x = 1n;
      if (true) {
        let x = 2n;
        x = x + 1n;
      }
      return x;
    }`;

    expect(() => compile(source, { tsSource: true })).not.toThrow();
  });

  it('the same collision shape gated on the ELSE branch also bails', () => {
    const code = `function f() {\n  let x = 1n;\n  if (false) {\n    console.log(0n);\n  } else {\n    let x = 2n;\n    x = x + 1n;\n  }\n  console.log(x);\n}`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('if (');
  });

  it('a taken branch declaring its OWN local that does NOT collide with anything outer still flattens normally (no regression)', () => {
    const out = tsPartialEval(`if (true) {\n  let y = 5n;\n  console.log(y);\n}`, 'f.ts');

    expect(out).not.toContain('if (');
    expect(out).toContain('let y = 5n;');
  });
});

describe('tsPartialEval (loop unrolling)', () => {
  it('unrolls a countable ++ loop into straight-line substituted statements', () => {
    const out = tsPartialEval(`let sum = 0n;\nfor (let i = 0n; i < 5n; i++) { sum = sum + i; }`, 'f.ts');

    expect(out).not.toContain('for (');
    for (const i of [0, 1, 2, 3, 4]) expect(out).toContain(`sum = sum + ${i}n;`);
  });

  it('unrolls += and plain "i = i + step" increments the same way', () => {
    const plusEquals = tsPartialEval(`let sum = 0n;\nfor (let i = 0n; i < 3n; i += 1n) { sum = sum + i; }`, 'f.ts');
    const reassign = tsPartialEval(`let sum = 0n;\nfor (let i = 0n; i < 3n; i = i + 1n) { sum = sum + i; }`, 'f.ts');

    for (const out of [plusEquals, reassign]) {
      expect(out).not.toContain('for (');
      for (const i of [0, 1, 2]) expect(out).toContain(`sum = sum + ${i}n;`);
    }
  });

  it('unrolls a backward (countdown) loop', () => {
    const out = tsPartialEval(`let sum = 0n;\nfor (let i = 3n; i > 0n; i--) { sum = sum + i; }`, 'f.ts');

    expect(out).not.toContain('for (');
    for (const i of [3, 2, 1]) expect(out).toContain(`sum = sum + ${i}n;`);
  });

  it('cascades: a nested if inside the unrolled body folds against the substituted counter', () => {
    const out = tsPartialEval(
      `let sum = 0n;
       for (let i = 0n; i < 4n; i++) {
         if (i === 2n) { sum = sum + 100n; } else { sum = sum + i; }
       }`,
      'f.ts',
    );

    expect(out).not.toContain('for (');
    expect(out).not.toContain('if (');
    expect(out).toContain('sum = sum + 0n;');
    expect(out).toContain('sum = sum + 1n;');
    expect(out).toContain('sum = sum + 100n;'); // the i===2n iteration took the "then" branch
    expect(out).toContain('sum = sum + 3n;');
  });

  it('a same-file const bound (data known at compile time) drives the unroll', () => {
    const out = tsPartialEval(
      `const N = 4n;\nlet product = 1n;\nfor (let i = 1n; i <= N; i++) { product = product * i; }`,
      'f.ts',
    );

    expect(out).not.toContain('for (');
    for (const i of [1, 2, 3, 4]) expect(out).toContain(`product = product * ${i}n;`);
  });

  it('a zero-iteration loop is removed entirely', () => {
    const out = tsPartialEval(`let sum = 0n;\nfor (let i = 0n; i < 0n; i++) { sum = sum + i; }`, 'f.ts');

    expect(out).not.toContain('for (');
    expect(out.trim()).toBe('let sum = 0n;');
  });

  it('bails (leaves the loop as real runtime code) past the unroll cap', () => {
    const out = tsPartialEval(`let sum = 0n;\nfor (let i = 0n; i < 1000n; i++) { sum = sum + i; }`, 'f.ts');

    expect(out).toContain('for (');
  });

  it('bails on a non-constant (parameter-derived) bound', () => {
    const out = tsPartialEval(
      `function f(n) { let sum = 0n; for (let i = 0n; i < n; i++) { sum = sum + i; } return sum; }`,
      'f.ts',
    );

    expect(out).toContain('for (');
  });

  it('bails when the body contains break/continue/return', () => {
    for (const escape of ['break;', 'continue;', 'return sum;']) {
      const out = tsPartialEval(
        `let sum = 0n;\nfor (let i = 0n; i < 5n; i++) { if (i === 3n) { ${escape} } sum = sum + i; }`,
        'f.ts',
      );

      expect(out).toContain('for (');
    }
  });

  it('bails when the body shadows the counter name', () => {
    const out = tsPartialEval(`let sum = 0n;\nfor (let i = 0n; i < 3n; i++) { let i = 99n; sum = sum + i; }`, 'f.ts');

    expect(out).toContain('for (');
  });

  it('bails (leaves the loop as real runtime code) when the body declares its OWN per-iteration local — unrolling splices N copies of the body directly into the enclosing statement list, so duplicating a non-counter `let`/`const` would produce invalid JS the next compile stage cannot even parse', () => {
    // Regression: before this fix, `unrollCountingLoop` spliced the substituted body straight
    // into the surrounding list regardless of what else it declared, producing (for this
    // example) THREE adjacent `let doubled = ...;` statements in the same scope —
    // `ts.transpileModule`'s printer happily printed that text, but `acorn.parse` (the very
    // next compile() stage) threw `SyntaxError: Identifier 'doubled' has already been declared`.
    const out = tsPartialEval(
      `let total = 0n;\nfor (let i = 0n; i < 3n; i++) { let doubled = i * 2n; total = total + doubled; }`,
      'f.ts',
    );

    expect(out).toContain('for (');
    expect(out.match(/let doubled/g)?.length).toBe(1); // the ORIGINAL declaration, never duplicated
  });

  it('bails even for a SINGLE unrolled iteration when the body-declared local collides with an OUTER, already-declared name of the same text (an enclosing FUNCTION scope, where sibling declarations ARE tracked in `shadowed` — unlike the top-level source-file scope, which never reserves its own sibling names this way)', () => {
    // A single iteration wouldn't duplicate anything WITHIN the unroll itself, but it would
    // still redeclare a name already reserved by the enclosing (function) scope — equally
    // invalid to emit, and equally guarded against via `collidesWithSurroundingDeclarations`'s
    // `outerNames` parameter (here, the function body Block's own pre-computed `shadowed` set).
    const out = tsPartialEval(
      `function f() {\n  let doubled = 999n;\n  let total = 0n;\n  for (let i = 0n; i < 1n; i++) { let doubled = i * 2n; total = total + doubled; }\n  return total;\n}`,
      'f.ts',
    );

    expect(out).toContain('for (');
  });
});

describe('tsPartialEval (while-loop unrolling — the counting idiom, reusing the for-loop unroller)', () => {
  it('unrolls "let i = <const>; while (i < bound) { ...; i = i + step; }"', () => {
    const out = tsPartialEval(`let sum = 0n;\nlet i = 0n;\nwhile (i < 5n) { sum = sum + i; i = i + 1n; }`, 'f.ts');

    expect(out).not.toContain('while (');
    for (const i of [0, 1, 2, 3, 4]) expect(out).toContain(`sum = sum + ${i}n;`);
  });

  it('unrolls ++ and += increments the same way as the for-loop path', () => {
    const plusPlus = tsPartialEval(`let sum = 0n;\nlet i = 0n;\nwhile (i < 3n) { sum = sum + i; i++; }`, 'f.ts');
    const plusEquals = tsPartialEval(`let sum = 0n;\nlet i = 0n;\nwhile (i < 3n) { sum = sum + i; i += 1n; }`, 'f.ts');

    for (const out of [plusPlus, plusEquals]) {
      expect(out).not.toContain('while (');
      for (const i of [0, 1, 2]) expect(out).toContain(`sum = sum + ${i}n;`);
    }
  });

  it('unrolls a backward (countdown) while loop', () => {
    const out = tsPartialEval(`let sum = 0n;\nlet i = 3n;\nwhile (i > 0n) { sum = sum + i; i--; }`, 'f.ts');

    expect(out).not.toContain('while (');
    for (const i of [3, 2, 1]) expect(out).toContain(`sum = sum + ${i}n;`);
  });

  it('the counter declaration itself is elided — no dangling `let i` left behind', () => {
    const out = tsPartialEval(`let sum = 0n;\nlet i = 0n;\nwhile (i < 3n) { sum = sum + i; i++; }`, 'f.ts');

    expect(out).not.toContain('let i');
  });

  it('bails (keeps the loop, keeps the declaration) when the counter is read after the loop', () => {
    // Eliding `let i` would leave a dangling reference — a "found index" pattern like this
    // must NOT unroll, since i's post-loop value is observed.
    const code = `let sum = 0n;\nlet i = 0n;\nwhile (i < 5n) { sum = sum + i; i = i + 1n; }\nreturn i;`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('while (');
    expect(out).toContain('let i');
  });

  it('bails when the counter decl is not IMMEDIATELY adjacent to the while', () => {
    const code = `let sum = 0n;\nlet i = 0n;\nsum = sum + 1n;\nwhile (i < 5n) { sum = sum + i; i = i + 1n; }`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('while (');
  });

  it('bails on a non-constant bound, same guards as the for-loop path', () => {
    const code = `function f(n) { let sum = 0n; let i = 0n; while (i < n) { sum = sum + i; i++; } return sum; }`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('while (');
  });

  it('bails (leaves the loop as real runtime code) when the body declares its OWN per-iteration local — same crash class as the numeric for-loop unroller, same fix (both share `unrollCountingLoop`)', () => {
    const code = `let total = 0n;\nlet i = 0n;\nwhile (i < 3n) { let doubled = i * 2n; total = total + doubled; i++; }`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('while (');
    expect(out.match(/let doubled/g)?.length).toBe(1);
  });

  it('cascades: a nested countdown while inside an unrolled for loop fully resolves', () => {
    const code = `
      let total = 0n;
      for (let i = 0n; i < 2n; i++) {
        let j = 0n;
        while (j < 3n) { total = total + i + j; j++; }
      }
    `;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).not.toContain('for (');
    expect(out).not.toContain('while (');
    // i=0: j=0,1,2 → "0n + 0n","0n + 1n","0n + 2n"; i=1: "1n + 0n","1n + 1n","1n + 2n"
    for (const [i, j] of [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ]) {
      expect(out).toContain(`total + ${i}n + ${j}n`);
    }
  });

  it('a while inside an if-branch is recognized once the branch is flattened', () => {
    const code = `let sum = 0n;\nif (true) { let i = 0n; while (i < 3n) { sum = sum + i; i++; } }`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).not.toContain('if (');
    expect(out).not.toContain('while (');
    for (const i of [0, 1, 2]) expect(out).toContain(`sum = sum + ${i}n;`);
  });
});

// ── tsPartialEval (constant propagation to reads + dead-declaration elimination) ──
//
// The fold pass above already resolves a chained top-level `const` initializer
// (`const b = a + 3` → `const b = 4n`) but, until now, never substituted the resolved value
// into a later bare-identifier READ (`console.log(c)` stayed `console.log(c)`), and never
// removed a declaration that became fully unused as a result. These two passes (run AFTER
// fold+unroll, on ITS output) close that gap. Scope-aware: only the SAME same-file
// top-level `const`s the fold pass already tracks are ever substituted; a nested
// `let`/`const`/`var`/parameter/catch-binding/for-loop-declaration of the same name shadows
// correctly, and DCE is a simple whole-file textual reference count taken AFTER
// substitution (so a coincidentally-same-named shadowing declaration elsewhere in the file
// can keep an otherwise-dead top-level const around — harmless, never incorrect).
//
// UPDATE: `consts` is no longer real-`const`-only — top-level `let`/`var` effectively-const
// detection (see the dedicated describe block further below) now ALSO feeds this same map, so
// the plain-mutable-variable chain this describe block used to pin as permanently untouched
// (the user's exact original motivating example) now collapses too, once every write to a
// name is accounted for. The genuinely-mutated (written more than once, or written
// conditionally) cases remain untouched — that's what the new describe block's own regression
// tests are for.
describe('tsPartialEval (constant propagation to reads + dead-declaration elimination)', () => {
  it('propagates a resolved const chain all the way to a bare-identifier read, eliminating every intermediate declaration', () => {
    const out = tsPartialEval(`const a = 1; const b = a + 3; const c = b + 4; console.log(c);`, 'f.ts');

    expect(out).not.toContain('const a');
    expect(out).not.toContain('const b');
    expect(out).not.toContain('const c');
    expect(out.trim()).toBe('console.log(8n);');
  });

  it('the user\'s exact original motivating shape (plain "let a, b, c;" predeclare + one assignment each) NOW fully collapses too, via effectively-const let/var detection', () => {
    // This is the user's exact original example, `let`/plain-assignment form — this describe
    // block used to pin this AS permanently untouched (this exact `it` name used to say "is
    // left completely alone"). Effectively-const `let`/`var` detection (the STRETCH
    // "declare-then-assign-once" idiom — see the dedicated describe block below for the full
    // story and its own much more thorough coverage) now recognizes `a`/`b`/`c` are each
    // written EXACTLY once, unconditionally, at the top level — indistinguishable from the
    // real-`const` chain in the test right above, so the result is byte-identical.
    const code = `let a, b, c;\na = 1;\nb = a + 3;\nc = b + 4;\nconsole.log(c);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).not.toContain('let a');
    expect(out).not.toContain('a = 1');
    expect(out).not.toContain('b = a');
    expect(out.trim()).toBe('console.log(8n);');
  });

  it('a same-named const declared inside a function shadows the outer one: the inner read is never substituted against the OUTER value, and the outer (post-function) read still substitutes against the outer const', () => {
    const code = `
      const a = 1;
      function f() {
        const a = 2;
        console.log(a);
      }
      console.log(a);
    `;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('const a = 2;');
    // The INNER (shadowed) read must never be substituted against the OUTER const's value —
    // it resolves to `f`'s OWN local value (2n) instead, via the LATER, local (per-function)
    // pass (see the "LOCAL, per-function constant propagation" describe block below for that
    // dedicated coverage) — never the wrong, outer `1n`.
    expect(out).toContain('console.log(2n);');
    expect(out.match(/console\.log\(1n\);/g)?.length).toBe(1); // only the OUTER read is `1n`
    // The OUTER (top-level) read correctly resolves against the outer const.
    expect(out).toContain('console.log(1n);');
    // The outer declaration itself is conservatively KEPT: dead-const-elimination is a flat,
    // whole-file textual Identifier count (not scope-aware), so the inner shadowing
    // declaration/read of the same name "a" is enough to (harmlessly) keep `const a = 1;`
    // around even though every real (unshadowed) read of it was already inlined above. This
    // pins the documented behavior (ts-frontend.ts's own comment on
    // deadConstEliminationTransformer) so a future change to the scope-tracking can't silently
    // flip this either direction without a test noticing.
    expect(out).toContain('const a = 1;');
  });

  it('a same-named `let` FIRST introduced INSIDE an if-branch shadows a top-level const for the REST of the function too — the real SauceScript compiler shares scope across if/while bodies (only a `for` loop pushes a genuine new one), so a read after the branch must stay a genuine runtime reference, never fold to the outer value', () => {
    // Regression: before this fix, `substituteConstReads`'s function-scope shadow computation
    // only ever collected names declared DIRECTLY in the function's own top-level statement
    // list (plus `var`-hoisted names) — a `let` first declared inside a nested `if`/`while`
    // branch was invisible to it, so `return FEE;` (textually AFTER the branch, in the SAME
    // function-level scope the branch's `let` persists into) was wrongly substituted with the
    // OUTER top-level const's value instead of staying an unresolved real runtime read.
    const out = tsPartialEval(
      `const FEE = 100n;\nfunction f(cond) {\n  if (cond) {\n    let FEE = 5n;\n  }\n  return FEE;\n}`,
      'f.ts',
    );

    expect(out).toContain('return FEE;');
    expect(out).not.toContain('return 100n;');
  });

  it("object-literal method/getter/setter shorthand: the method/setter's OWN parameter shadows an outer const of the same name — the param read stays a bare identifier, not the outer const's literal", () => {
    // Regression: MethodDeclaration/GetAccessorDeclaration/SetAccessorDeclaration are not
    // FunctionDeclaration/FunctionExpression/ArrowFunction (isPlainFunctionScope's 3 shapes),
    // so without dedicated handling their own parameter list never shadows the outer scope —
    // a read of the parameter would be wrongly rewritten to the outer const's literal value.
    const methodCode = `const a = 1;\nconst obj = {\n  method(a) { console.log(a); }\n};\nconsole.log(a);`;
    const methodOut = tsPartialEval(methodCode, 'f.ts');

    expect(methodOut).toContain('method(a) { console.log(a); }'); // the param read: untouched
    expect(methodOut).toContain('console.log(1n);'); // the outer (unshadowed) read: substituted

    const setterCode = `const a = 1;\nconst obj = { set prop(a) { console.log(a); } };\nconsole.log(a);`;
    const setterOut = tsPartialEval(setterCode, 'f.ts');

    expect(setterOut).toContain('set prop(a) { console.log(a); }');
    expect(setterOut).toContain('console.log(1n);');

    const getterCode = `const x = 1;\nconst obj = { get prop() { const x = 2; return x; } };\nconsole.log(x);`;
    const getterOut = tsPartialEval(getterCode, 'f.ts');

    expect(getterOut).toContain('const x = 2;');
    // Shadowed by the getter body's own `const x` — this pass never substitutes it against
    // the OUTER `1n`; the LATER, local (per-function) pass then separately resolves it
    // against the getter's OWN value, `2n` (isMethodLikeScope's 3 shapes are function-like
    // scopes for that pass too), so the final read is `return 2n;`, never `return 1n;`.
    expect(getterOut).toContain('return 2n;');
    expect(getterOut).not.toContain('return 1n;');
    expect(getterOut).toContain('console.log(1n);'); // the outer read still substitutes
  });

  it('object-literal method shorthand with a COMPUTED name: the computed key expression is still substituted (it is a genuine read, evaluated in the outer scope)', () => {
    const code = `const KEY = 1;\nconst obj = {\n  [KEY](a) { return a; }\n};`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('[1n](a)');
    expect(out).not.toContain('KEY');
  });

  it('a top-level const read only via object-literal SHORTHAND (`{ a }`) is substituted AND its now-dead declaration is eliminated — the shorthand rewrite reuses the original Identifier as the new property KEY, which must not count as a phantom remaining reference', () => {
    // Regression: constPropagationTransformer's shorthand handling rewrites `{ a }` into
    // `{ a: <literal> }` by reusing `node.name` as the synthesized PropertyAssignment's key —
    // countIdentifierRefs must not mistake that label for a surviving read, or the const can
    // never be eliminated despite every real read already being inlined. This is exactly the
    // struct-literal idiom this codebase uses for router calls (PoolKey-style construction).
    const code = `const fee = 3000n;\nconst tickSpacing = 60n;\nfunction build(currency0, currency1, hooks) {\n  return { currency0, currency1, fee, tickSpacing, hooks };\n}`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('fee: 3000n');
    expect(out).toContain('tickSpacing: 60n');
    expect(out).not.toContain('const fee');
    expect(out).not.toContain('const tickSpacing');
  });

  it('a top-level const referenced only inside a helper function has its value baked into the body, and its own now-dead declaration is removed', () => {
    const out = tsPartialEval(`const RATE = 3n;\nexport function scale(x) { return x * RATE; }`, 'f.ts');

    expect(out).not.toContain('RATE');
    expect(out).toContain('return x * 3n;');
  });

  it('a const used only as a fully-unrolled loop bound is eliminated once unrolling consumes its only reference', () => {
    const out = tsPartialEval(`const N = 4n;\nlet sum = 0n;\nfor (let i = 0n; i < N; i++) { sum = sum + i; }`, 'f.ts');

    expect(out).not.toContain('for (');
    expect(out).not.toContain('const N');
    for (const i of [0, 1, 2, 3]) expect(out).toContain(`sum = sum + ${i}n;`);
  });

  it('the same const ALSO used elsewhere (inside the unrolled body) is correctly substituted at every surviving site too', () => {
    const out = tsPartialEval(
      `const N = 4n;\nlet sum = 0n;\nfor (let i = 0n; i < N; i++) { sum = sum + N; }\nconsole.log(sum);`,
      'f.ts',
    );

    expect(out).not.toContain('for (');
    expect(out).not.toContain('const N');
    expect(out.match(/sum = sum \+ 4n;/g)?.length).toBe(4); // all 4 unrolled copies got the literal
    expect(out).toContain('console.log(sum);');
  });

  it('multiple reads of the same const across different statements are ALL substituted, and the declaration is eliminated only once every read is gone', () => {
    const out = tsPartialEval(
      `const K = 5n;\nconsole.log(K);\nconsole.log(K + 1n);\nfunction f() { return K; }`,
      'f.ts',
    );

    expect(out).not.toContain('const K');
    expect(out).toContain('console.log(5n);'); // the bare read — this feature's job
    expect(out).toContain('console.log(6n);'); // K + 1n — already folded by the EXISTING pass
    expect(out).toContain('return 5n;');
  });

  it('a const whose only use was inside a since-pruned dead if-branch is eliminated once branch-pruning removes that reference', () => {
    const out = tsPartialEval(`const SOME_CONST = 7n;\nif (false) { console.log(SOME_CONST); }`, 'f.ts');

    // The whole if-statement (the const's only use) was already pruned away by the EXISTING
    // fold pass — leaving zero references, so this pass's DCE removes the now-dead const too.
    expect(out.trim()).toBe('');
  });

  it('a const used only as a loop bound that DOES NOT unroll (past MAX_UNROLL_ITERATIONS) still gets its bound substituted into the surviving runtime loop, and is still eliminated', () => {
    // A real 3-stage interaction: foldTransformer bails on unrolling (the loop stays a real
    // `for`), constPropagationTransformer still walks INTO that surviving loop's condition and
    // substitutes the literal there, and deadConstEliminationTransformer then correctly drops
    // the now-fully-substituted `const N` declaration — leaving a genuine runtime loop with
    // its bound inlined as a literal, not a dangling reference to a removed declaration.
    const out = tsPartialEval(
      `const N = 1000n;\nlet sum = 0n;\nfor (let i = 0n; i < N; i++) { sum = sum + i; }`,
      'f.ts',
    );

    expect(out).toContain('for ('); // unrolling bailed — past the cap
    expect(out).toContain('i < 1000n'); // ...but the bound was still substituted
    expect(out).not.toContain('const N'); // ...and the now-dead declaration was still removed
  });

  it('a const used only as a loop bound that DOES NOT unroll because the body has a break/continue behaves the same way', () => {
    const out = tsPartialEval(
      `const N = 5n;\nlet sum = 0n;\nfor (let i = 0n; i < N; i++) { if (i === 2n) { break; } sum = sum + i; }`,
      'f.ts',
    );

    expect(out).toContain('for (');
    expect(out).toContain('i < 5n;');
    expect(out).not.toContain('const N');
  });
});

// ── tsPartialEval (folding a CALL to a same-file, side-effect-free, single-return function) ──
//
// `tsEvalConst` also resolves a CallExpression when its callee is a same-file top-level
// `FunctionDeclaration` whose ENTIRE body is exactly one `return <expr>;` statement, with
// zero CallExpression/NewExpression anywhere in that return expression (or in any parameter's
// default initializer) — a body that never calls anything trivially can't recurse, so no
// separate recursion analysis is needed — and every argument itself resolves to a constant.
// A folded call becomes an ordinary literal AST node at the CALL SITE ONLY: the callee's own
// `FunctionDeclaration` is never touched (it might still be called elsewhere with runtime
// args), so this composes for free with the existing const-propagation + dead-declaration-
// elimination passes below (a folded call's result is just another resolved top-level const
// value once bound to a `const NAME = <call>;` initializer) and with loop unrolling (a call
// inside an unrolled body folds independently per substituted-counter copy, since unrolling
// re-enters this same fold pass on each copy).
describe('tsPartialEval (folds a call to a same-file, side-effect-free, single-return function)', () => {
  it('folds the motivating example end to end: the call resolves to a literal, which then fully composes with const-propagation + dead-declaration elimination', () => {
    const out = tsPartialEval(`function double(x) { return x * 2n; }\nconst y = double(21n);\nconsole.log(y);`, 'f.ts');

    expect(out).toContain('function double(x)'); // the callee declaration is never eliminated
    expect(out).not.toContain('const y'); // y's own declaration is now fully dead, and removed
    expect(out).toContain('console.log(42n);'); // the call folded, then propagated all the way to the read
  });

  it('never folds a call whose body contains a NESTED call — even to another, itself-foldable function (soundness guard: no recursion analysis needed only because a zero-call body trivially cannot recurse)', () => {
    const out = tsPartialEval(
      `function inc(x) { return x + 1n; }
       function addTwice(x) { return inc(x) + 1n; }
       const z = addTwice(5n);
       console.log(z);`,
      'f.ts',
    );

    expect(out).toContain('addTwice(5n)'); // the call site is left completely untouched
    expect(out).toContain('console.log(z)'); // z never resolved, so its read stays a bare identifier
  });

  it('never folds a call whose body is more than one statement, or contains an if/loop, instead of exactly one `return <expr>;`', () => {
    const multiStatement = tsPartialEval(
      `function f(x) { let y = x; return y; }\nconst a = f(1n);\nconsole.log(a);`,
      'f.ts',
    );
    const withIf = tsPartialEval(
      `function g(x) { if (x > 0n) { return x; } return 0n; }\nconst b = g(1n);\nconsole.log(b);`,
      'f.ts',
    );

    expect(multiStatement).toContain('f(1n)');
    expect(multiStatement).toContain('console.log(a)');
    expect(withIf).toContain('g(1n)');
    expect(withIf).toContain('console.log(b)');
  });

  it('folds one call site with all-constant arguments while leaving another call site (a non-constant, parameter-derived argument) untouched — the callee declaration remains either way', () => {
    const out = tsPartialEval(
      `function double(x) { return x * 2n; }
       const a = double(3n);
       console.log(a);
       function useDouble(n) { return double(n); }`,
      'f.ts',
    );

    expect(out).toContain('function double(x)'); // still genuinely called elsewhere with a runtime arg
    expect(out).toContain('console.log(6n);'); // the constant call site: folded, propagated, decl eliminated
    expect(out).not.toContain('const a');
    expect(out).toContain('return double(n);'); // the non-constant call site: untouched, still a real call
  });

  it('folds a call whose body reads a module-level top-level const alongside its own parameter, using the already-resolved value as a lookup alongside the parameter overlay', () => {
    const out = tsPartialEval(
      `const RATE = 2n;
       function scale(x) { return x * RATE; }
       const y = scale(21n);
       console.log(y);`,
      'f.ts',
    );

    expect(out).toContain('console.log(42n);');
    expect(out).not.toContain('const y');
    expect(out).not.toContain('RATE'); // baked into scale's own body by the SEPARATE propagation pass, then eliminated
  });

  it('inside an already-unrolled loop, each copy folds the call independently with its own per-iteration counter argument', () => {
    const out = tsPartialEval(
      `function double(x) { return x * 2n; }
       for (let i = 0n; i < 3n; i++) { console.log(double(i)); }`,
      'f.ts',
    );

    expect(out).not.toContain('for (');
    expect(out).toContain('console.log(0n);');
    expect(out).toContain('console.log(2n);');
    expect(out).toContain('console.log(4n);');
  });

  it('a call omitting an argument for a parameter with a DEFAULT value evaluates that default too (a deliberate choice, not a rejection — see the ts-frontend.ts doc comment on tsEvalCall)', () => {
    const out = tsPartialEval(
      `function inc(x, step = 1n) { return x + step; }\nconst a = inc(5n);\nconsole.log(a);`,
      'f.ts',
    );

    expect(out).toContain('console.log(6n);');
    expect(out).not.toContain('const a');
  });

  it('a later default may reference an EARLIER already-bound parameter (documented left-to-right default evaluation)', () => {
    const out = tsPartialEval(
      `function f(a, b = a + 1n) { return a + b; }\nconst z = f(10n);\nconsole.log(z);`,
      'f.ts',
    );

    expect(out).toContain('console.log(21n);');
    expect(out).not.toContain('const z');
  });

  it('never folds a call to a callee reached through property access (`obj.method(...)`), only a same-file plain-identifier callee', () => {
    const out = tsPartialEval(
      `const obj = { double(x) { return x * 2n; } };\nconst a = obj.double(21n);\nconsole.log(a);`,
      'f.ts',
    );

    expect(out).toContain('obj.double(21n)');
    expect(out).toContain('console.log(a)');
  });

  it('never folds a call whose callee is a GENERATOR function — calling it yields an Iterator, never its `return`ed value', () => {
    const out = tsPartialEval(
      `function* gen() { return 7n; }\nfunction useGen() { return gen(); }\nconsole.log(useGen());`,
      'f.ts',
    );

    expect(out).toContain('gen()'); // the call site is left completely untouched
  });

  it('never folds a call whose callee is `async` — calling it yields a Promise, never its `return`ed value directly', () => {
    const out = tsPartialEval(`async function foo() { return 5n; }\nconst y = foo();\nconsole.log(y);`, 'f.ts');

    expect(out).toContain('foo()'); // the call site is left completely untouched
    expect(out).toContain('console.log(y)'); // never resolved, so its read stays a bare identifier
  });

  it("a call omitting an argument never lets an EARLIER default silently fall back to an outer const sharing a LATER (not-yet-bound) parameter's name — real JS/TS TDZ semantics mean this would actually throw at runtime, so folding must decline rather than compute the wrong value", () => {
    const out = tsPartialEval(
      `const b = 999n;\nfunction foo(a = b, b = 5n) { return a + b; }\nconst y = foo();\nconsole.log(y);`,
      'f.ts',
    );

    expect(out).toContain('foo()'); // the call site is left completely untouched
    expect(out).not.toContain('console.log(1004n)'); // NOT the outer const's value (999 + 5)
  });

  describe('soundness: a shadowed callee/identifier name is never resolved against an unrelated top-level binding', () => {
    it('never folds a call whose callee name is shadowed by a NESTED function declaration of the same name', () => {
      const out = tsPartialEval(
        `function calc(x) { return x + 1n; }
         function outer() {
           function calc(x) { return x + 100n; }
           return calc(5n);
         }
         console.log(outer());`,
        'f.ts',
      );

      // The inner `calc` call must stay untouched — folding it against the OUTER `calc`
      // would hardcode 6n (5+1) instead of leaving the real (inner) call for the compiler.
      expect(out).toContain('calc(5n)');
      expect(out).not.toContain('console.log(6n)');
    });

    it("never folds a call whose callee name is shadowed by the enclosing function's OWN parameter (the higher-order-function pattern)", () => {
      const out = tsPartialEval(
        `function greet(name) { return name + 100n; }
         function farewell(name) { return name + 999n; }
         function callIt(greet) { return greet(1n); }
         const y = callIt(farewell);
         console.log(y);`,
        'f.ts',
      );

      // `greet` inside `callIt`'s body refers to whatever's PASSED as the `greet` parameter,
      // never necessarily the top-level `greet` function — must not fold to a fixed literal.
      expect(out).toContain('greet(1n)');
    });

    it('never folds a call whose callee name is shadowed by a block-scoped `let` inside an if-branch', () => {
      const out = tsPartialEval(
        `function calc(x) { return x + 1n; }
         function outer(flag) {
           if (flag) {
             let calc = (n) => n + 999n;
             return calc(1n);
           }
           return 0n;
         }`,
        'f.ts',
      );

      expect(out).toContain('calc(1n)');
    });

    it('never folds a call shadowed by a block-scoped `let` even when the enclosing if-condition IS constant (so the branch is flattened directly into the enclosing statement list)', () => {
      const out = tsPartialEval(
        `function calc(x) { return x + 1n; }
         function outer() {
           if (true) {
             let calc = (n) => n + 999n;
             return calc(1n);
           }
           return 0n;
         }`,
        'f.ts',
      );

      expect(out).toContain('calc(1n)');
    });

    it("never folds a plain identifier/arithmetic expression whose name is shadowed by the enclosing function's OWN parameter, even when a top-level const of the exact same name exists", () => {
      const out = tsPartialEval(`const x = 999n;\nfunction f(x) { return x * 2n; }`, 'f.ts');

      // `x` inside `f`'s body is its own parameter, never the outer `const x` — the
      // multiplication must stay real runtime arithmetic, not fold to 1998n.
      expect(out).toContain('return x * 2n;');
      expect(out).not.toContain('1998');
    });
  });
});

// ── tsPartialEval (constant propagation never touches an assignment/update TARGET) ──
//
// constPropagationTransformer's substitution visitor must never replace the left side of an
// assignment (`=`/`+=`/etc.), a `++`/`--` operand, or any (possibly nested, destructuring)
// write-target position with a top-level const's literal value — doing so would either
// silently change the program's meaning or emit syntactically-invalid output (`1n = 2n;`,
// `1n++;`). This mirrors the guard `foldTransformer`/`ASSIGNMENT_OPERATOR_TOKENS` already
// applies to the (separate) folding pass, just for the propagate-to-reads pass.
describe('tsPartialEval (constant propagation never substitutes an assignment/update target)', () => {
  it('never substitutes the left side of a plain assignment, even reassigning a top-level const by name', () => {
    const out = tsPartialEval(`const a = 1n;\na = 2n;\nconsole.log(a);`, 'f.ts');

    expect(out).toContain('a = 2n;'); // NOT "1n = 2n;"
  });

  it('never substitutes the left side of a compound assignment (+=)', () => {
    const out = tsPartialEval(`const a = 1n;\nfunction main() { a += 2n; return a; }`, 'f.ts');

    expect(out).toContain('a += 2n;'); // NOT "1n += 2n;"
  });

  it('never substitutes the operand of a ++ / -- update expression (prefix or postfix)', () => {
    const postfix = tsPartialEval(`const a = 1n;\nfunction main() { a++; return a; }`, 'f.ts');
    const prefix = tsPartialEval(`const a = 1n;\nfunction main() { ++a; return a; }`, 'f.ts');

    expect(postfix).toContain('a++;'); // NOT "1n++;"
    expect(prefix).toContain('++a;'); // NOT "++1n;"
  });

  it("never substitutes a destructuring-assignment target (object or array), even reusing a top-level const's name as the shorthand target", () => {
    const objectPattern = tsPartialEval(`const a = 1n;\nlet obj = { a: 5n };\n({ a } = obj);\nconsole.log(a);`, 'f.ts');
    const arrayPattern = tsPartialEval(`const a = 1n;\nlet arr = [5n];\n[a] = arr;\nconsole.log(a);`, 'f.ts');

    expect(objectPattern).toContain('({ a } = obj);'); // NOT "({ a: 1n } = obj);"
    expect(arrayPattern).toContain('[a] = arr;'); // NOT "[1n] = arr;"
  });

  it("still substitutes genuine READS nested inside a write-target expression: a property/element-access target's object expression and computed key", () => {
    const out = tsPartialEval(
      `const IDX = 0n;\nfunction main(obj, arr) {\n  obj.x = 1n;\n  arr[IDX] = 2n;\n  return arr[IDX];\n}`,
      'f.ts',
    );

    // `arr[IDX]`'s computed key IS a genuine read — substituted both as a write target's key
    // and in the later plain read.
    expect(out).toContain('arr[0n] = 2n;');
    expect(out).toContain('return arr[0n];');
    expect(out).not.toContain('IDX');
  });
});

describe('tsPartialEval (foldTransformer never folds a shadowed identifier against an outer/top-level const)', () => {
  it('a function parameter sharing a top-level const name is never folded into ordinary arithmetic', () => {
    const out = tsPartialEval(`const RATE = 10n;\nfunction f(RATE) {\n  return RATE + 1n;\n}`, 'f.ts');

    expect(out).toContain('return RATE + 1n;'); // NOT `return 11n;`
  });

  it('a function parameter sharing a top-level const name never prunes an if/else branch — regression for the ts-evaluator fallback, which does its OWN identifier resolution unaware of local shadowing', () => {
    const out = tsPartialEval(
      `const FLAG = true;\nfunction f(FLAG) {\n  if (FLAG) { return 1; } else { return 2; }\n}`,
      'f.ts',
    );

    // Before the fix: `tsEvalConst` correctly failed closed on the shadowed read, but
    // `foldExpression` fell through to `tryEvaluate` (ts-evaluator's own `evaluate()`),
    // which resolved `FLAG` against the OUTER `const FLAG = true` anyway — silently pruning
    // the whole `if` down to `return 1;` and discarding the parameter entirely. Confirmed
    // empirically reachable on real (unmodified) main before this fix.
    expect(out).toContain('if (');
    expect(out).toContain('return 1;');
    expect(out).toContain('return 2;');
  });

  it('a same-named `let`/`const` declared inside an if/while branch shadows a top-level const for arithmetic INSIDE that branch too', () => {
    const out = tsPartialEval(
      `const SCALE = 2n;\nfunction f(cond) {\n  if (cond) {\n    let SCALE = 9n;\n    console.log(SCALE + 1n);\n  }\n}`,
      'f.ts',
    );

    // `foldTransformer` itself must not fold `SCALE + 1n` against the OUTER `SCALE = 2n`
    // (which would silently produce `3n`) — the later local (per-function) propagation pass
    // then correctly substitutes the branch's OWN `SCALE = 9n` into the read, so the final
    // pipeline output ends up `9n + 1n` (not further combined by that pass — see its own
    // "no gratuitous rewrite" contract), never the wrong `3n`.
    expect(out).not.toContain('console.log(3n)');
    expect(out).toContain('console.log(9n + 1n);');
  });

  it('a same-named `let`/`const` FIRST introduced INSIDE an if-branch shadows a top-level const for a BINARY/CALL read AFTER the branch too — not just a bare identifier read', () => {
    // Regression: `constPropagationTransformer`'s `substituteConstReads` already covers a bare
    // identifier read after the branch (see the "constant propagation" describe block's own
    // "shadows a top-level const for the REST of the function too" test), but `foldTransformer`
    // itself — which folds a BinaryExpression/CallExpression DIRECTLY, before that later pass
    // ever runs — had its OWN, separate shadow computation that only ever called
    // `collectVarNames` (var-hoisted names only), never `collectLexicalNamesInScope`. So
    // `RATE + 1n`, itself an `isFoldableValueExpression` foldTransformer resolves on its own,
    // was wrongly folded straight to the OUTER `RATE = 5n`'s value (`return 6n;`) regardless of
    // `cond`, even though `RATE` is locally shadowed by the branch's own `let RATE = 999n;` for
    // the rest of the function (confirmed reachable, including via real EVM execution, before
    // this fix).
    const binaryOut = tsPartialEval(
      `const RATE = 5n;\nfunction f(cond) {\n  if (cond) {\n    let RATE = 999n;\n  }\n  return RATE + 1n;\n}`,
      'f.ts',
    );

    expect(binaryOut).toContain('return RATE + 1n;');
    expect(binaryOut).not.toContain('return 6n;');

    // Same root cause, reached via a CallExpression argument instead of a BinaryExpression:
    // `tsEvalCall` evaluates each argument against the SAME `shadowed` set `foldTransformer`
    // computed for the call site, so an under-shadowed set lets a shadowed argument resolve
    // against the wrong (outer) const too.
    const callOut = tsPartialEval(
      `const RATE = 5n;\nfunction double(x) { return x * 2n; }\nfunction f(cond) {\n  if (cond) {\n    let RATE = 999n;\n  }\n  return double(RATE);\n}`,
      'f.ts',
    );

    expect(callOut).toContain('return double(RATE);');
    expect(callOut).not.toContain('return 10n;');
  });
});

// ── tsPartialEval (local `new Array(n)` construction folding) ──
//
// Stage 5 of 6 in `tsPartialEval`'s pipeline, between `deadConstEliminationTransformer` and
// `localConstPropagationTransformer`: when a function-local `new Array(n)`'s size, every
// element, and every later read index are ALL provably constant, and the binding provably
// never escapes, the declaration, every construction write, and every resolvable read are
// eliminated entirely, replaced by the bare literal each read would have produced. This is what
// makes the motivating probe below compile BYTE-IDENTICAL to a bare `return 2n;` — before this
// pass, the unrolled loop already turned every index/value into a literal, but `NEW_ARRAY`/every
// `SET_INDEX`/the final `INDEX` stayed real runtime bytecode regardless.
const localArrayTargets: CompileTarget[] = ['v1', 'v12'];

describe('tsPartialEval (local `new Array(n)` construction folding)', () => {
  describe('positive: folds completely — byte-identical to the fully-inlined literal, on both targets', () => {
    for (const target of localArrayTargets) {
      describe(`target ${target}`, () => {
        it('the motivating probe: an unrolled bigint-counter loop construction + a read — folds to a bare literal', () => {
          const source = `
            function main(): Uint256 {
              const arr = new Array(3);
              for (let i = 0n; i < 3n; i++) {
                arr[i] = i * 2n;
              }
              return arr[1];
            }
          `;
          const result = compile(source, { tsSource: true, target });
          const literal = compile(`function main() { return 2n; }`, { target });
          const bytes = Array.from(result.bytecode[0]);

          expect(bytes).toEqual(Array.from(literal.bytecode[0]));
          expect(bytes).not.toContain(OPS.NEW_ARRAY);
          expect(bytes).not.toContain(OPS.SET_INDEX);
          expect(bytes).not.toContain(OPS.INDEX);
        });

        it('a PLAIN-NUMBER counter unroll pins the synthesized-NumericLiteral fallback (`evalArrayConst`) — without it, this family silently never folds', () => {
          const source = `
            function main() {
              const arr = new Array(3);
              for (let i = 0; i < 3; i++) {
                arr[i] = i * 2;
              }
              return arr[1];
            }
          `;
          const result = compile(source, { tsSource: true, target });
          const literal = compile(`function main() { return 2n; }`, { target });

          expect(Array.from(result.bytecode[0])).toEqual(Array.from(literal.bytecode[0]));
        });

        it('straight-line writes with no loop at all', () => {
          const source = `function main() { const a = new Array(2); a[0] = 5n; a[1] = 7n; return a[1]; }`;
          const result = compile(source, { tsSource: true, target });
          const literal = compile(`function main() { return 7n; }`, { target });

          expect(Array.from(result.bytecode[0])).toEqual(Array.from(literal.bytecode[0]));
        });

        it("the `while`-counting idiom constructs the array — exercises `tryUnrollCountingWhile`'s splice path", () => {
          const source = `
            function main() {
              const arr = new Array(3);
              let i = 0n;
              while (i < 3n) { arr[i] = i; i++; }
              return arr[2];
            }
          `;
          const result = compile(source, { tsSource: true, target });
          const literal = compile(`function main() { return 2n; }`, { target });

          expect(Array.from(result.bytecode[0])).toEqual(Array.from(literal.bytecode[0]));
        });

        it('a read index via a top-level const folds', () => {
          const source = `
            const K = 1n;
            function main() {
              const arr = new Array(3);
              arr[0] = 10n; arr[1] = 20n; arr[2] = 30n;
              return arr[K];
            }
          `;
          const result = compile(source, { tsSource: true, target });
          const literal = compile(`function main() { return 20n; }`, { target });

          expect(Array.from(result.bytecode[0])).toEqual(Array.from(literal.bytecode[0]));
        });

        it('out-of-order writes still fold — write order is unobservable once every index is written exactly once', () => {
          // Each read folds to its literal independently (`10n + 20n + 30n`), but the SURROUNDING
          // arithmetic isn't re-collapsed to a single `60n` — `foldTransformer` (the pass that
          // folds literal arithmetic) already ran, strictly BEFORE this one, back when these
          // operands were still real `ElementAccessExpression`s; re-running it isn't part of
          // this pipeline. The load-bearing claim is that the ARRAY itself is fully gone (no
          // NEW_ARRAY/SET_INDEX/INDEX) — the real EVM integration test proves the arithmetic
          // still computes the right VALUE (60n) end to end.
          const source = `
            function main() {
              const arr = new Array(3);
              arr[2] = 30n; arr[0] = 10n; arr[1] = 20n;
              return arr[0] + arr[1] + arr[2];
            }
          `;
          const out = tsPartialEval(source, 'f.ts');

          expect(out).not.toContain('new Array');
          expect(out).not.toContain('arr[');
          expect(out).toContain('10n + 20n + 30n');

          const bytes = Array.from(compile(source, { tsSource: true, target }).bytecode[0]);

          expect(bytes).not.toContain(OPS.NEW_ARRAY);
          expect(bytes).not.toContain(OPS.SET_INDEX);
          expect(bytes).not.toContain(OPS.INDEX);
        });

        it('two independent arrays fold — both a sequential and an INTERLEAVED construction', () => {
          const sequential = `
            function main() {
              const a = new Array(2);
              a[0] = 1n; a[1] = 2n;
              const b = new Array(2);
              b[0] = 10n; b[1] = 20n;
              return a[0] + a[1] + b[0] + b[1];
            }
          `;
          const interleaved = `
            function main() {
              const a = new Array(2);
              const b = new Array(2);
              a[0] = 1n;
              b[0] = 10n;
              a[1] = 2n;
              b[1] = 20n;
              return a[0] + a[1] + b[0] + b[1];
            }
          `;

          for (const source of [sequential, interleaved]) {
            const out = tsPartialEval(source, 'f.ts');

            expect(out).not.toContain('new Array');
            expect(out).not.toContain('a[');
            expect(out).not.toContain('b[');
            expect(out).toContain('1n + 2n + 10n + 20n');

            const bytes = Array.from(compile(source, { tsSource: true, target }).bytecode[0]);

            expect(bytes).not.toContain(OPS.NEW_ARRAY);
            expect(bytes).not.toContain(OPS.SET_INDEX);
            expect(bytes).not.toContain(OPS.INDEX);
          }
        });

        it('zero reads — pure dead-code elimination of the whole construction', () => {
          const source = `function main() { const a = new Array(2); a[0] = 1n; a[1] = 2n; return 5n; }`;
          const result = compile(source, { tsSource: true, target });
          const literal = compile(`function main() { return 5n; }`, { target });

          expect(Array.from(result.bytecode[0])).toEqual(Array.from(literal.bytecode[0]));
        });

        it("a `let`-declared array (the real recipe-code style, e.g. ecoswap's `let inp: Tuple = new Array(...)`) folds too", () => {
          const source = `function main() { let arr = new Array(2); arr[0] = 3n; arr[1] = 4n; return arr[0]; }`;
          const result = compile(source, { tsSource: true, target });
          const literal = compile(`function main() { return 3n; }`, { target });

          expect(Array.from(result.bytecode[0])).toEqual(Array.from(literal.bytecode[0]));
        });

        it('composes with stage 6 (LOCAL scalar propagation): an accumulator loop over a folded array feeds the scalar engine all the way to the RETURN literal — the load-bearing pipeline-DIRECTION proof', () => {
          // `total`'s own `let`/`+=` bookkeeping isn't itself dead-code-eliminated (neither this
          // pass nor the local scalar pass attempts that cleanup — see both passes' own "out of
          // scope" notes), so the emitted bytecode isn't byte-identical to a bare `return 3600n;`
          // — but the ARRAY is completely gone (no NEW_ARRAY/SET_INDEX/INDEX), and the RETURN
          // value itself resolves to the literal `3600n` (0x0e10), proving each folded read fed
          // straight into the scalar constant-propagation pass, exactly as designed.
          const source = `
            function main() {
              const fees = new Array(3);
              fees[0] = 100n; fees[1] = 500n; fees[2] = 3000n;
              let total = 0n;
              for (let i = 0n; i < 3n; i++) { total += fees[i]; }
              return total;
            }
          `;
          const out = tsPartialEval(source, 'f.ts');

          expect(out).not.toContain('new Array');
          expect(out).not.toContain('fees[');
          expect(out).toContain('return 3600n;');

          const bytes = Array.from(compile(source, { tsSource: true, target }).bytecode[0]);

          expect(bytes).not.toContain(OPS.NEW_ARRAY);
          expect(bytes).not.toContain(OPS.SET_INDEX);
          expect(bytes).not.toContain(OPS.INDEX);
          expect(Buffer.from(bytes).toString('hex')).toContain('0e10'); // the 2-byte push of 3600
        });
      });
    }
  });

  it('tsPartialEval string check: the motivating probe has no `new Array`, no `arr[`, and a bare `return 2n;`', () => {
    const out = tsPartialEval(
      `function main() {
        const arr = new Array(3);
        for (let i = 0n; i < 3n; i++) { arr[i] = i * 2n; }
        return arr[1];
      }`,
      'f.ts',
    );

    expect(out).not.toContain('new Array');
    expect(out).not.toContain('arr[');
    expect(out).toContain('return 2n;');
  });

  it('a nested if AFTER construction reading the array: BOTH reads fold, and the (runtime-conditioned) `if` correctly survives untouched', () => {
    const out = tsPartialEval(
      `function main(c) {
        const arr = new Array(2);
        arr[0] = 10n;
        arr[1] = 20n;
        if (c === 1n) { return arr[0]; }
        return arr[1];
      }`,
      'f.ts',
    );

    expect(out).not.toContain('new Array');
    expect(out).not.toContain('arr[');
    expect(out).toContain('return 10n;');
    expect(out).toContain('return 20n;');
    expect(out).toContain('if (');
  });

  // ── return-escape fold: `return arr;` in main() → a literal array, forced to uint256/BYTE_32 ──
  //
  // The ONE new authorized escape shape beyond Rule 6's element read (`scanArrayUses` Rule 6b):
  // `return arr;` (or `return (arr);`), as the SOLE, entire operand of a `ReturnStatement`, in a
  // top-level `function main` ONLY, for a fully-resolved (every element known, none negative)
  // candidate. WHY this is safe at all: today a `new Array(n)`-built TUPLE returned from a Sauce
  // program leaks raw Solidity MEMORY ADDRESSES (v1's `execute()` returns `ctx.dynamicResult.data`
  // verbatim for a TUPLE — see the integration test's own real-EVM proof), so replacing it with a
  // REAL, well-defined literal array is a strict improvement, not a behavior change any real
  // consumer could observe. WHY main()-only: a helper's returned array has no working consumer
  // TODAY (every read/write across the call boundary already reverts — see the integration
  // test's `ts-frontend-array.test.ts` note), but folding it into an IMMUTABLE packed literal
  // could regress a FUTURE fix to that gap; main's value structurally can't have that exposure —
  // it exits the program and `main` itself is never callable.
  describe('return-escape fold: `return arr;` in main() → literal array, forced-width encoding', () => {
    it('the motivating case (formerly a decline test): `return arr;` in main() now folds to a literal array', () => {
      const source = `function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; return arr; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).not.toContain('new Array');
      expect(out).toContain('return [1n, 2n];');
    });

    it('straight-line construction folds to a literal array return', () => {
      const source = `
        function main() {
          const arr = new Array(3);
          arr[0] = 0n;
          arr[1] = 2n;
          arr[2] = 4n;
          return arr;
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).not.toContain('new Array');
      expect(out).toContain('return [0n, 2n, 4n];');
    });

    it('an unrolled-loop construction folds to the SAME literal array return as straight-line writes — composes with the loop unroller exactly like the existing element-read rule does', () => {
      const source = `
        function main() {
          const arr = new Array(3);
          for (let i = 0n; i < 3n; i++) { arr[i] = i * 2n; }
          return arr;
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).not.toContain('new Array');
      expect(out).toContain('return [0n, 2n, 4n];');
    });

    it('parenthesized `return (arr);` folds too — `stripParens` sees through the wrapper', () => {
      const source = `function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; return (arr); }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).not.toContain('new Array');
      expect(out).toContain('[1n, 2n]');

      // The parenthesized shape still compiles end to end (not just a text-shape assertion).
      const result = compile(source, { tsSource: true });

      expect(Array.from(result.bytecode[0])).not.toContain(OPS.NEW_ARRAY);
    });

    it('`export function main` folds too — `extractFunctionDeclarations` already treats it as main', () => {
      const source = `export function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; return arr; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).not.toContain('new Array');
      expect(out).toContain('return [1n, 2n];');
    });

    it('multiple returns of the same array all fold, AND a return coexists with an element-read of the same array — both fold independently', () => {
      const source = `
        function main(c) {
          const a = new Array(2);
          a[0] = 1n;
          a[1] = 2n;
          if (c === 1n) { return a; }
          return a[0];
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).not.toContain('new Array');
      expect(out).not.toContain('a[');
      expect(out).toContain('return [1n, 2n];');
      expect(out).toContain('return 1n;');
    });

    describe('MAX_FOLDED_RETURN_ARRAY_ELEMENTS (64) boundary', () => {
      const makeSource = (n: number): string => {
        const writes = Array.from({ length: n }, (_, i) => `arr[${i}] = ${i}n;`).join(' ');

        return `function main() { const arr = new Array(${n}); ${writes} return arr; }`;
      };

      it('exactly at the cap (64 elements) folds', () => {
        const out = tsPartialEval(makeSource(64), 'f.ts');

        expect(out).not.toContain('new Array');
      });

      it('one over the cap (65 elements) disqualifies — the growth-direction cap is separate from (and smaller than) MAX_FOLDED_ARRAY_ELEMENTS (256)', () => {
        const out = tsPartialEval(makeSource(65), 'f.ts');

        expect(out).toContain('new Array(');
      });
    });

    describe('width mechanism: forcing BYTE_32 (uint256) element width', () => {
      it('bytecode-exact: the folded array literal is BYTE_32-forced — element-type byte 0x20 and 3 32-byte words, not the auto-narrowed 1-byte packing', () => {
        const source = `
          function main() {
            const arr = new Array(3);
            arr[0] = 0n;
            arr[1] = 2n;
            arr[2] = 4n;
            return arr;
          }
        `;
        const result = compile(source, { tsSource: true });
        const bytes = result.bytecode[0];

        expect(bytes[0]).toBe(OPS.ARRAY);
        expect(bytes[1]).toBe(3); // length
        expect(bytes[2]).toBe(OPS.BYTE_32); // element-type byte — forced wide, not BYTE_1
        // header(op,len,type) + 3 32-byte words + v1's trailing halt byte.
        expect(bytes.length).toBe(3 + 3 * 32 + 1);

        const hex = Buffer.from(bytes).toString('hex');
        const word = (n: number): string => n.toString(16).padStart(64, '0');

        // Word 0 = 0, word 1 = 2, word 2 = 4, each a full 32-byte big-endian value —
        // exactly ABI-decodable as uint256[3].
        expect(hex).toBe('9203' + '20' + word(0) + word(2) + word(4) + '00');
      });

      it('width non-contamination: an ordinary user-written array literal keeps its existing auto-narrowed encoding — identical WITH and WITHOUT tsSource, and unaffected by a fold elsewhere in the same file', () => {
        const plainSource = `function main() { return [0n, 2n, 4n]; }`;
        const withoutTs = compile(plainSource);
        const withTs = compile(plainSource, { tsSource: true });

        expect(Buffer.from(withoutTs.bytecode[0]).toString('hex')).toBe('92030100020400');
        expect(Buffer.from(withTs.bytecode[0]).toString('hex')).toBe('92030100020400');
      });

      it('width non-contamination, the mixed-file case: a user-written return-position literal and a fold-synthesized one in the SAME main() both compile — the user one stays narrow, the fold-synthesized one is wide', () => {
        const source = `
          function main(c) {
            if (c === 1n) { return [1n, 2n]; }
            const arr = new Array(3);
            arr[0] = 0n;
            arr[1] = 2n;
            arr[2] = 4n;
            return arr;
          }
        `;
        const result = compile(source, { tsSource: true, args: [1n] });
        const hex = Buffer.from(result.bytecode[0]).toString('hex');

        expect(hex).toContain('9202010102'); // narrow, user-written [1n, 2n]: op,len(2),type(BYTE_1),01,02
        expect(hex).toContain('920320'); // wide, fold-synthesized [0n, 2n, 4n]: op,len(3),type(BYTE_32)
      });

      it('`tsPartialEvalWithMeta` returns the expected fingerprint set; `tsPartialEval` keeps its plain-string, non-breaking signature', () => {
        const source = `
          function main() {
            const arr = new Array(3);
            arr[0] = 0n;
            arr[1] = 2n;
            arr[2] = 4n;
            return arr;
          }
        `;
        const meta = tsPartialEvalWithMeta(source, 'f.ts');

        expect(meta.wideReturnArrays).toEqual(new Set(['0,2,4']));
        expect(meta.text).toBe(tsPartialEval(source, 'f.ts'));
        expect(typeof tsPartialEval(source, 'f.ts')).toBe('string');
      });

      it('`tsPartialEvalWithMeta` returns an EMPTY fingerprint set for a source with no such fold', () => {
        const meta = tsPartialEvalWithMeta(`function main() { return 5n; }`, 'f.ts');

        expect(meta.wideReturnArrays.size).toBe(0);
      });

      it("v12 and svm targets produce the same wide array-literal bytes as v1 (minus v1's trailing halt byte) — the encoder is shared across all three targets", () => {
        const source = `
          function main() {
            const arr = new Array(3);
            arr[0] = 0n;
            arr[1] = 2n;
            arr[2] = 4n;
            return arr;
          }
        `;
        const v1 = compile(source, { tsSource: true, target: 'v1' });
        const v12 = compile(source, { tsSource: true, target: 'v12' });
        const svm = compile(source, { tsSource: true, target: 'svm' });

        const v1Hex = Buffer.from(v1.bytecode[0]).toString('hex');
        const v12Hex = Buffer.from(v12.bytecode[0]).toString('hex');
        const svmHex = Buffer.from(svm.bytecode[0]).toString('hex');

        expect(v1Hex).toBe(v12Hex + '00'); // v1 appends a trailing halt byte
        expect(svmHex).toBe(v12Hex); // svm shares v12's postfix encoder exactly
      });

      it('a cached recompile of a main()-return-fold source still returns the wide (BYTE_32) bytecode', () => {
        clearDefaultCompileCache();
        const source = `function main() { const arr = new Array(3); arr[0] = 0n; arr[1] = 2n; arr[2] = 4n; return arr; }`;
        const first = compile(source, { tsSource: true });
        const second = compile(source, { tsSource: true }); // cache hit — same (source, options) key

        expect(Array.from(second.bytecode[0])).toEqual(Array.from(first.bytecode[0]));
        expect(second.bytecode[0][2]).toBe(OPS.BYTE_32);
        clearDefaultCompileCache();
      });
    });
  });

  describe('adversarial: every one of these DECLINES to fold (leaves real NEW_ARRAY/SET_INDEX/INDEX bytecode) — still correct, just unfolded', () => {
    it('aliasing (`const b = arr; return b[0];`) disqualifies', () => {
      const source = `function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; const b = arr; return b[0]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');

      const result = compile(source, { tsSource: true });

      expect(Array.from(result.bytecode[0])).toContain(OPS.NEW_ARRAY);
    });

    it('passing the bare identifier as a call argument (`helper(arr)`) disqualifies', () => {
      const source = `
        function helper(x) { return x[0]; }
        function main() {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          return helper(arr);
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    // The bare-identifier `return arr;` shape ITSELF now FOLDS in main() — see the new
    // "return-escape fold" describe block right after this one for that positive coverage and
    // the width mechanism it relies on. The decline coverage below replaces this test with the
    // shapes that still correctly disqualify even with the new Rule 6b in play.
    it('`return arr;` in a HELPER (not main) still disqualifies — the return-escape fold is gated to main() ONLY', () => {
      const source = `
        function h() {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          return arr;
        }
        function main() {
          return h();
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');

      const result = compile(source, { tsSource: true, treeshake: false });

      expect(Array.from(result.bytecode[0])).toContain(OPS.NEW_ARRAY);
    });

    it('`return arr;` from an ARROW-bound `main` still disqualifies — the fold only recognizes a top-level `function main`', () => {
      const source = `
        const main = () => {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          return arr;
        };
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('a NEGATIVE element disqualifies the return-escape fold — folding it would turn a compiling program into a compile ERROR', () => {
      const source = `
        function main() {
          const arr = new Array(2);
          arr[0] = -5n;
          arr[1] = 2n;
          return arr;
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');

      // Pinning WHY the bail exists: the equivalent hand-written literal already throws today,
      // independent of this feature — `encodeArray`'s `allStatic`/`allDynamic` check rejects a
      // NEG-prefixed element outright.
      expect(() => compile('function main(){ return [-5n, 1n]; }')).toThrow(/array elements must be literals/);
    });

    it('`return (arr, 5n);` (a comma expression, not the bare identifier) disqualifies', () => {
      const source = `
        function main() {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          return (arr, 5n);
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('`const b = arr; return b;` (aliasing, THEN returning the alias) disqualifies', () => {
      const source = `
        function main() {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          const b = arr;
          return b;
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('`return foo(arr);` (the array passed as a call argument, in return position) disqualifies', () => {
      const source = `
        function foo(x) { return x[0]; }
        function main() {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          return foo(arr);
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('a HOLE (partial writes) plus `return arr;` disqualifies — Rule 6b never even runs for a candidate that never validated in the first place', () => {
      const source = `
        function main() {
          const arr = new Array(3);
          arr[0] = 1n;
          arr[1] = 2n;
          return arr;
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');

      const result = compile(source, { tsSource: true });

      expect(Array.from(result.bytecode[0])).toContain(OPS.NEW_ARRAY);
      expect(Array.from(result.bytecode[0])).toContain(OPS.SET_INDEX);
    });

    it('partial writes (a hole — only 2 of 3 indices written) disqualifies', () => {
      const source = `function main() { const arr = new Array(3); arr[0] = 1n; arr[1] = 2n; return arr[0]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');

      const result = compile(source, { tsSource: true });

      expect(Array.from(result.bytecode[0])).toContain(OPS.NEW_ARRAY);
      expect(Array.from(result.bytecode[0])).toContain(OPS.SET_INDEX);
    });

    it('a duplicate write to the SAME index disqualifies (last-write-wins is deliberately NOT permitted)', () => {
      const source = `function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; arr[0] = 3n; return arr[0]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');

      const result = compile(source, { tsSource: true });

      expect(Array.from(result.bytecode[0])).toContain(OPS.NEW_ARRAY);
    });

    it('a write AFTER a read disqualifies', () => {
      const source = `function main() { const a = new Array(2); const x = a[0]; a[1] = 9n; return x + a[1]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('a non-constant write index inside a NON-unrollable loop (a parameter-derived bound) disqualifies', () => {
      const source = `
        function main(n) {
          const arr = new Array(3);
          arr[0] = 0n; arr[1] = 0n; arr[2] = 0n;
          for (let i = 0n; i < n; i++) { arr[i] = i; }
          return arr[0];
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
      expect(out).toContain('for (');

      expect(() => compile(source, { tsSource: true })).not.toThrow();
    });

    it('a non-constant read index (`return arr[n];`, `n` a parameter) disqualifies', () => {
      const source = `function main(n) { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; return arr[n]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');

      expect(() => compile(source, { tsSource: true })).not.toThrow();
    });

    it('a compound element write (`arr[0] += 1n;`) disqualifies', () => {
      const source = `function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; arr[0] += 1n; return arr[0]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('rebinding the array (`arr = new Array(2);` later) disqualifies', () => {
      const source = `
        function main() {
          let arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          arr = new Array(2);
          return arr[0];
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('`arr.length` disqualifies (foldable in principle to the size literal, but never verified on-chain, so excluded from v1)', () => {
      const source = `function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; return arr.length; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('a method call on the array (`arr.push(1n)`) disqualifies — no method whitelist', () => {
      const source = `function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = 2n; arr.push(1n); return arr[0]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('`for (const v of arr)` over a local array is untouched — still throws `not implemented: ForOfStatement`, exactly like today (a deliberate v1 non-goal, not a regression)', () => {
      const source = `
        function main() {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          let sum = 0n;
          for (const v of arr) { sum = sum + v; }
          return sum;
        }
      `;

      expect(() => compile(source, { tsSource: true })).toThrow(/ForOfStatement/);
    });

    it('a nested closure touching the array disqualifies — a nested arrow reading `arr[0]`', () => {
      const source = `
        function main() {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          const f = () => arr[0];
          return f();
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });

    it('the name redeclared inside an if-branch disqualifies — the exact shadowing class this session fixed three times elsewhere in this file', () => {
      const source = `
        function main(c) {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          if (c) { let arr = 5n; }
          return arr[0];
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
      expect(out).toContain('return arr[0];');
    });

    it('an out-of-range read (`arr[5]` on a size-3 array) disqualifies', () => {
      const source = `function main() { const arr = new Array(3); arr[0] = 1n; arr[1] = 2n; arr[2] = 3n; return arr[5]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
      expect(() => compile(source, { tsSource: true })).not.toThrow();
    });

    it('a runtime size (`new Array(n)`, `n` a parameter) is never even a candidate — rejected at the cheapest gate', () => {
      const source = `function main(n) { const arr = new Array(n); arr[0] = 1n; return arr[0]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(n)');
    });

    it("a declaration nested inside an if-block is never a candidate — not a DIRECT entry of the function body's own statement list", () => {
      const source = `
        function main(c) {
          let result = 0n;
          if (c) {
            const arr = new Array(2);
            arr[0] = 1n;
            arr[1] = 2n;
            result = arr[0] + arr[1];
          }
          return result;
        }
      `;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(2)');
      expect(() => compile(source, { tsSource: true })).not.toThrow();
    });

    it('self-referential construction (`arr[1] = arr[0] + 1n;`) disqualifies — deliberately out of scope for v1', () => {
      const source = `function main() { const arr = new Array(2); arr[0] = 1n; arr[1] = arr[0] + 1n; return arr[1]; }`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(');
    });
  });

  describe('regression + zero-change guards', () => {
    it('regression guard: the existing top-level `new Array` fixture (never a lookup-table candidate) is completely untouched by this NEW pass too — by construction, this pass never examines a top-level statement list', () => {
      const source = `const arr = new Array(3n);\narr[0] = 1n;\nconsole.log(arr[0]);`;
      const out = tsPartialEval(source, 'f.ts');

      expect(out).toContain('new Array(3n)');
      expect(out).toContain('console.log(arr[0]);');
    });

    it('zero-change guard: the identical (untyped) source compiled WITHOUT tsSource never invokes this pass — real NEW_ARRAY/SET_INDEX opcodes remain, for a fold-eligible AND a decline-eligible fixture', () => {
      const foldEligible = `function main() { const arr = new Array(3); arr[0] = 0n; arr[1] = 2n; arr[2] = 4n; return arr[1]; }`;
      const declineEligible = `function main() { const arr = new Array(3); arr[0] = 0n; return arr[0]; }`;

      for (const source of [foldEligible, declineEligible]) {
        const result = compile(source); // no tsSource — plain acorn path, ts-frontend.ts never runs
        const bytes = Array.from(result.bytecode[0]);

        expect(bytes).toContain(OPS.NEW_ARRAY);
        expect(bytes).toContain(OPS.SET_INDEX);
      }
    });
  });
});

// ── tsPartialEval (LOCAL, per-function constant propagation) ──
//
// Everything above tracks only same-file TOP-LEVEL `const`s (plus effectively-const `let`/
// `var`s, and array/object lookup tables — still all TOP-LEVEL). A `let`/`const` declared and
// reassigned INSIDE a function body got none of that benefit until `localConstPropagationTransformer`
// — a FIFTH `before` transformer stage, appended LAST (after fold/table-fold/const-propagation/
// dead-const-elimination), consuming everything above's output. It is a control-flow-sensitive
// (but deliberately NOT a real fixpoint dataflow) sequential abstract interpreter, walked fresh
// and independently per function-like scope, tracking a `Map<name, bigint | NAC>` per variable
// per program point and substituting a read with its known value wherever provable.
describe('tsPartialEval (LOCAL, per-function constant propagation)', () => {
  it('straight-line reassignment folds all the way through to the final read', () => {
    const out = tsPartialEval(`function f() { let x = 1n; x = x + 3n; x = x + 4n; return x; }`, 'f.ts');

    expect(out).toContain('return 8n;');
  });

  it('if/else where BOTH branches assign the SAME constant: still constant after the merge, and substitutes correctly', () => {
    const out = tsPartialEval(
      `function f(cond) { let x = 1n; if (cond) { x = 5n; } else { x = 5n; } return x; }`,
      'f.ts',
    );

    expect(out).toContain('return 5n;');
  });

  it('if/else where the branches assign DIFFERENT constants: NAC after the merge — a read after the if must NOT be substituted (the single most important soundness guard in this feature)', () => {
    const out = tsPartialEval(
      `function f(cond) { let x = 1n; if (cond) { x = 5n; } else { x = 6n; } return x; }`,
      'f.ts',
    );

    expect(out).toContain('return x;'); // NOT substituted to 5n, 6n, or anything else
    expect(out).not.toContain('return 5n;');
    expect(out).not.toContain('return 6n;');
  });

  it('if/else where only ONE branch reassigns a variable: correctly merges the touched branch against the PRE-IF value the untouched branch implicitly keeps', () => {
    // The (missing) else branch implicitly keeps x's pre-if value (5n); the then-branch
    // reassigns it to that SAME value, so the merge still yields a constant.
    const agree = tsPartialEval(`function f(cond) { let x = 5n; if (cond) { x = 5n; } return x; }`, 'f.ts');

    expect(agree).toContain('return 5n;');

    // Same shape, but the then-branch's reassignment DISAGREES with the untouched branch's
    // pre-if value — proving the merge is a genuine value comparison, not a "one side
    // touched it, keep whatever it set" shortcut.
    const disagree = tsPartialEval(`function f(cond) { let x = 5n; if (cond) { x = 9n; } return x; }`, 'f.ts');

    expect(disagree).toContain('return x;');
    expect(disagree).not.toContain('return 9n;');
  });

  it('a variable reassigned inside a genuine (non-unrolled) runtime loop is NAC both inside the loop and after it — even the FIRST reference, textually before any write', () => {
    const out = tsPartialEval(
      `function f(n) {
         let sum = 0n;
         for (let i = 0n; i < n; i++) {
           console.log(sum);
           sum = sum + i;
         }
         console.log(sum);
         return sum;
       }`,
      'f.ts',
    );

    // `n` is a parameter (non-constant bound) — the EXISTING loop-unroller bails, so this
    // stays a real runtime `for` by the time this pass sees it, and `sum` is written inside.
    expect(out).toContain('for (');
    expect(out).not.toContain('console.log(0n)');
    expect(out.match(/console\.log\(sum\)/g)?.length).toBe(2); // neither reference substituted
    expect(out).toContain('return sum;'); // not `return 0n;` or any other literal
  });

  it('a variable NEVER written inside a loop, read both inside and after it, still correctly propagates through', () => {
    const out = tsPartialEval(
      `function f(n) {
         const RATE = 5n;
         let count = 0n;
         for (let i = 0n; i < n; i++) {
           console.log(RATE);
           count = count + 1n;
         }
         console.log(RATE);
         return count;
       }`,
      'f.ts',
    );

    expect(out).toContain('for (');
    expect(out.match(/console\.log\(5n\)/g)?.length).toBe(2); // both references substituted
    expect(out).not.toContain('console.log(RATE)');
    expect(out).toContain('return count;'); // count IS written every iteration — NAC
  });

  it('a nested function/arrow closing over and REASSIGNING an outer local variable bails the WHOLE outer function — left completely untouched (regression/soundness guard)', () => {
    const code = `
      function outer() {
        let x = 1n;
        const inner = () => { x = 2n; };
        return x;
      }
    `;
    const out = tsPartialEval(code, 'f.ts');

    // Were this pass NOT to bail, it would see only the straight-line `let x = 1n;` in
    // outer's OWN sequential walk (a nested function-like scope is an opaque leaf to it) and
    // wrongly substitute the final read to `return 1n;` — silently wrong, since this
    // compiler compiles a `.catch()`-style handler's body against the SAME context as its
    // surrounding code (`processBlock` in compiler/src/processor/expression.ts), so a real
    // reassignment inside one genuinely affects the enclosing scope, not a harmless no-op.
    expect(out).toContain('return x;');
    expect(out).not.toContain('return 1n;');
    expect(out).not.toContain('return 2n;');
  });

  it('a nested function/arrow that only touches its OWN locals (no outer-local closure) does NOT bail the outer function', () => {
    const code = `
      function outer() {
        let x = 1n;
        const inner = () => { let x = 2n; return x; };
        return x;
      }
    `;
    const out = tsPartialEval(code, 'f.ts');

    // `inner` shadows with its OWN local `x` — never touches outer's — so outer's own
    // never-reassigned `x` still resolves normally.
    expect(out).toContain('return 1n;');
  });

  it('a nested function/arrow that only READS (never reassigns) an outer local variable ALSO bails the whole outer function — same closure-bail rule, a distinct code path (collectFreeIdentifierNames treats read and write identically) from the write-case above, worth its own regression test', () => {
    const code = `
      function outer() {
        let x = 5n;
        const inner = () => { console.log(x); };
        return x;
      }
    `;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('return x;');
    expect(out).not.toContain('return 5n;');
  });

  it.each([
    ['switch', `function f(cond) { let x = 1n; switch (cond) { case 1: x = 2n; break; default: break; } return x; }`],
    ['try/catch', `function f() { let x = 1n; try { x = 2n; } catch (e) { x = 3n; } return x; }`],
    ['for...of', `function f(arr) { let x = 1n; for (const a of arr) { x = a; } return x; }`],
    ['for...in', `function f(obj) { let x = 1n; for (const k in obj) { x = 2n; } return x; }`],
    ['labeled break/continue', `function f() { let x = 1n; outer: while (cond) { x = 2n; break outer; } return x; }`],
  ])(
    'bails the WHOLE containing function on a %s construct — the final read stays a genuine (unsubstituted) runtime reference, never folded to any of the values assigned inside (regression guard: none of these 5 has a case in the real compiler processStatement switch, so bailing costs nothing, but a future refactor narrowing containsDisallowedConstruct must not silently start mis-optimizing them)',
    (_label, code) => {
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('return x;');
      expect(out).not.toContain('return 1n;');
      expect(out).not.toContain('return 2n;');
      expect(out).not.toContain('return 3n;');
    },
  );

  it('a top-level const read from inside a function body, alongside a genuine local, interacts correctly — no duplicate substitution, no conflict with the existing whole-file pass', () => {
    const out = tsPartialEval(`const RATE = 3n;\nfunction f() { let x = 1n; let y = x + RATE; return y; }`, 'f.ts');

    expect(out).not.toContain('RATE');
    expect(out).not.toContain('const RATE');
    expect(out).toContain('return 4n;');
  });

  it('does not gratuitously rewrite an already-literal declaration that has nothing to fold (no identifier involved)', () => {
    // Regression guard for the `containsIdentifier` check in `foldOrSubstitute`: without it,
    // `toLiteralNode` would silently upgrade a plain NumericLiteral into a canonical BigInt
    // literal on every touch, even when nothing was actually substituted.
    const out = tsPartialEval(`function f() { const a = 2; return a; }`, 'f.ts');

    expect(out).toContain('const a = 2;'); // NOT rewritten to `const a = 2n;`
    expect(out).toContain('return 2n;'); // the READ still correctly resolves (as a bigint literal)
  });

  it("a top-level const colliding with a name FIRST introduced by a `let` inside an if branch is never read back through this pass's own top-level-consts fallback — walkIfStatement's merge must see the name too (soundness guard: this pass's own `env` pre-seed must cover every name reachable in the function's body, not just this statement list's OWN direct declarations)", () => {
    const out = tsPartialEval(
      `const FEE = 100n;\nfunction f(cond) {\n  if (cond) {\n    let FEE = 5n;\n  }\n  return FEE;\n}`,
      'f.ts',
    );

    // Before the fix: `FEE` was never a pre-if key of `env` (only directly-declared names in
    // the FUNCTION's own top-level statement list are pre-seeded, and this `let` is nested
    // inside the if's own block) — so `walkIfStatement`'s merge silently skipped it, and the
    // later `return FEE;` fell through this pass's own top-level-consts fallback, wrongly
    // resolving to the top-level `100n` and discarding `cond` (and the branch's own write)
    // entirely.
    expect(out).toContain('return FEE;');
    expect(out).not.toContain('return 100n;');
  });

  it('the same collision shape with the shadowing name introduced by ONLY the else branch', () => {
    const out = tsPartialEval(
      `const FEE = 100n;\nfunction f(cond) {\n  if (cond) {\n  } else {\n    let FEE = 5n;\n  }\n  return FEE;\n}`,
      'f.ts',
    );

    expect(out).toContain('return FEE;');
    expect(out).not.toContain('return 100n;');
  });

  it('a destructuring-assignment target invalidates (marks NAC) every scalar name it writes — defensive fail-closed guard, even though the real compiler does not yet support this assignment shape (processAssignmentMutation throws for it) so it is unreachable via compile() today', () => {
    const arrayPattern = tsPartialEval(`function f() {\n  let x = 1n;\n  [x] = someCall();\n  return x;\n}`, 'f.ts');
    const objectPattern = tsPartialEval(
      `function f() {\n  let x = 1n;\n  ({ x } = someCall());\n  return x;\n}`,
      'f.ts',
    );

    // Before the fix: `walkAssignmentExpr` only ever invalidated `env` when `expr.left` was a
    // bare Identifier — an ArrayLiteralExpression/ObjectLiteralExpression target (destructuring
    // assignment) left the STALE tracked value (`1n`) in `env`, so the read after it was
    // wrongly folded to `return 1n;` instead of staying the real, now-unknown runtime value.
    expect(arrayPattern).toContain('return x;');
    expect(arrayPattern).not.toContain('return 1n;');
    expect(objectPattern).toContain('return x;');
    expect(objectPattern).not.toContain('return 1n;');
  });

  it("a call to an eligible same-file top-level function now folds even when its argument only becomes constant through this pass's OWN local flow analysis — a natural side effect of reusing the real 4-argument tsEvalConst/tsEvalCall family rather than a separate evaluator", () => {
    const out = tsPartialEval(
      `function double(n) { return n * 2n; }\nfunction f() { let x = 3n; let y = double(x); return y + 1n; }`,
      'f.ts',
    );

    expect(out).toContain('return 7n;');
  });

  it('never folds a call whose callee name is shadowed by a NESTED function declaration inside the SAME local scope this pass is walking — the local pass must not resolve the call against an unrelated top-level function of the same name', () => {
    const out = tsPartialEval(
      `function calc(x) { return x + 1n; }
       function outer() {
         function calc(x) { return x + 100n; }
         let y = 1n;
         return calc(y);
       }`,
      'f.ts',
    );

    // Folding against the OUTER `calc` would hardcode 2n (1+1) instead of leaving the real
    // (inner) call for the compiler to resolve against the nested declaration.
    expect(out).not.toContain('return 2n;');
  });

  // ── Ternary (conditional-expression) folding ──
  //
  // `tsEvalConst` itself has no case for `ts.isConditionalExpression` anywhere (a ternary's
  // mainstream path folds via `foldTransformer`'s own separate, MODULE-scope mechanism
  // instead) — this LOCAL pass had no equivalent, so `x = localCond ? 5n : 6n;` fell through
  // to NAC even when `localCond` was a plain local variable this pass's own reasoning already
  // knew. `evalLocalConst`/`substituteLocalReads`'s own `ConditionalExpression` case close
  // this gap: the condition is evaluated through this pass's own `LocalResolution`, and if it
  // resolves, the WHOLE ternary is structurally replaced by whichever branch was selected,
  // cascading into anything further foldable inside it.
  describe('ternary (conditional-expression) folding', () => {
    it('the motivating repro: a locally-known condition folds an assignment-RHS ternary all the way through to the final read', () => {
      const out = tsPartialEval(`function f() { let x=1n; const A=true; x = A?5n:6n; return x; }`, 'f.ts');

      expect(out).toContain('return 5n;');
      expect(out).not.toContain('?');
      expect(out).not.toContain('return x;');
    });

    it('a nested ternary in the TAKEN branch, itself keyed on a different, also locally-known condition, cascades to a single literal', () => {
      const out = tsPartialEval(
        `function f() {
           let a = 1n;
           let b = 2n;
           let x = a > 0n ? (b > 0n ? 10n : 20n) : 30n;
           return x;
         }`,
        'f.ts',
      );

      expect(out).toContain('return 10n;');
      expect(out).not.toContain('?');
    });

    it('a ternary NESTED inside another expression (not directly an assignment RHS) whose condition is locally known folds completely — the shape that would otherwise be an illegal ternary position downstream', () => {
      const out = tsPartialEval(
        `function f() {
           let a = 1n;
           let b = (a > 0n ? 2n : 3n) + 1n;
           return b;
         }`,
        'f.ts',
      );

      expect(out).toContain('return 3n;');
      expect(out).not.toContain('?');
    });

    it('a genuinely unknown condition (a function parameter) declines to fold — the ternary stays intact, structurally untouched', () => {
      const out = tsPartialEval(
        `function f(n) {
           let b = (n > 0n ? 2n : 3n) + 1n;
           return b;
         }`,
        'f.ts',
      );

      expect(out).toContain('n > 0n ? 2n : 3n');
      expect(out).toContain('return b;');
      expect(out).not.toContain('return 3n;');
      expect(out).not.toContain('return 4n;');
    });

    it('sub-parts of an unresolvable ternary still get locally-known identifiers substituted, without collapsing the ternary itself', () => {
      const out = tsPartialEval(
        `function f(n) {
           const SCALE = 2n;
           let b = n > 0n ? SCALE : 3n;
           return b;
         }`,
        'f.ts',
      );

      expect(out).toContain('n > 0n ? 2n : 3n'); // the SCALE READ substituted, ternary itself untouched
      // Dead-local-declaration elimination is out of scope for this pass (documented
      // limitation) — `const SCALE = 2n;` itself is still emitted, just no longer READ.
      expect(out).not.toContain('? SCALE :');
      expect(out).toContain('return b;');
    });

    it('interaction with the if/else merge-at-join rule: a ternary condition resolved only via a PRIOR if/else merge in the same function uses the already-merged value', () => {
      const out = tsPartialEval(
        `function f(cond) {
           let x = 1n;
           if (cond) { x = 5n; } else { x = 5n; }
           let y = x > 0n ? 10n : 20n;
           return y;
         }`,
        'f.ts',
      );

      expect(out).toContain('return 10n;');
      expect(out).not.toContain('?');
    });

    it('interaction with the loop-NAC rule: a ternary depending on a variable written inside a real (non-unrolled) loop correctly declines to fold', () => {
      const out = tsPartialEval(
        `function f(n) {
           let sum = 0n;
           for (let i = 0n; i < n; i++) {
             sum = sum + i;
           }
           let y = sum > 0n ? 1n : 2n;
           return y;
         }`,
        'f.ts',
      );

      expect(out).toContain('sum > 0n ? 1n : 2n');
      expect(out).toContain('return y;');
      expect(out).not.toContain('return 1n;');
      expect(out).not.toContain('return 2n;');
    });

    it('a ternary inside a function this pass bails on (closure reassignment) is left untouched along with the rest of the containing function', () => {
      const out = tsPartialEval(
        `function outer() {
           let x = 1n;
           const inner = () => { x = 2n; };
           let y = x ? 5n : 6n;
           return y;
         }`,
        'f.ts',
      );

      // Were this pass NOT to bail the whole function, `x`'s own straight-line `let x = 1n;`
      // would look constant in outer's OWN sequential walk (the nested closure is an opaque
      // leaf to it) and the ternary would wrongly fold to `return 5n;`.
      expect(out).toContain('x ? 5n : 6n');
      expect(out).toContain('return y;');
      expect(out).not.toContain('return 5n;');
      expect(out).not.toContain('return 6n;');
    });

    it('a ternary passed AS A CALL ARGUMENT to an opaque (non-foldable) call resolves the argument in place, leaving the call itself untouched — the OTHER illegal-position shape the base grammar rejects', () => {
      const out = tsPartialEval(
        `function f() {
           let a = 1n;
           console.log(a > 0n ? 2n : 3n);
         }`,
        'f.ts',
      );

      expect(out).toContain('console.log(2n)');
      expect(out).not.toContain('?');
    });

    it('a ternary passed as a call argument to an UNRESOLVABLE condition is left structurally intact', () => {
      const out = tsPartialEval(
        `function f(n) {
           console.log(n > 0n ? 2n : 3n);
         }`,
        'f.ts',
      );

      expect(out).toContain('n > 0n ? 2n : 3n');
    });

    it('the RHS of a COMPOUND assignment (`+=`) is also routed through the ternary bridge — the tracked value updates, not just the printed text', () => {
      // Before this fix, `evalCompoundAssignmentResult` called the bare `tsEvalConst` directly
      // (never `evalLocalConst`), so a ternary RHS printed correctly (`substituteLocalReads`
      // already collapsed it in the emitted code) but the TRACKED value stayed NAC — a
      // subsequent read of `x` incorrectly stayed unfolded even though the emitted assignment
      // was already a fully-resolved literal.
      const out = tsPartialEval(
        `function f() {
           let x = 10n;
           const cond = true;
           x += cond ? 1n : 2n;
           return x;
         }`,
        'f.ts',
      );

      expect(out).toContain('x += 1n;');
      expect(out).toContain('return 11n;');
      expect(out).not.toContain('?');
      expect(out).not.toContain('return x;');
    });

    it('a compound assignment with a genuinely UNRESOLVABLE ternary RHS correctly declines (NAC) — no false fold', () => {
      const out = tsPartialEval(
        `function f(cond) {
           let x = 10n;
           x += cond ? 1n : 2n;
           return x;
         }`,
        'f.ts',
      );

      expect(out).toContain('x += cond ? 1n : 2n;');
      expect(out).toContain('return x;');
    });
  });
});

// ── tsPartialEval (effectively-const let/var detection — top-level scope only) ──
//
// A top-level `let`/`var` written EXACTLY ONCE across its entire (shadow-respecting) file is
// semantically indistinguishable from a `const` (the standard "effectively final" analysis) —
// so it's folded into the SAME `consts`-driven const-propagation-to-reads + dead-declaration-
// elimination machinery tested above, real `const`s and effectively-const `let`/`var`s treated
// identically from that point on. Two shapes, both scoped to TOP-LEVEL declarations only
// (never function-local/nested-scope — that stays out of scope, matching the const-tracking
// boundary):
//
//   PRIMARY  — `let x = <init>;` where `x` is never written again anywhere in the file.
//   STRETCH  — `let x; x = <init>;` (a bare predeclaration, no initializer, immediately or
//              later followed by its ONE later top-level assignment in the SAME statement
//              list) — including the multi-declarator `let a, b, c;` predeclaration form.
//
// Both landed. "Written again" is a flat SYNTACTIC count (assignment/compound-assignment/
// update-expression/destructuring-assignment target), not a reachability analysis — a second
// write inside an `if`/loop/function that might never execute at runtime still disqualifies
// the name; this is the conservative, sound rule the feature requires.
describe('tsPartialEval (effectively-const let/var detection)', () => {
  describe('PRIMARY: let x = <init>; never written again', () => {
    it("the user's exact original example, plain-assignment form, now fully collapses (STRETCH lands this — see the STRETCH describe block below for the dedicated coverage)", () => {
      // Requirement 1 of the task: this is also covered as its own dedicated `it` in the
      // "constant propagation" describe block above (updated in place, since it used to pin
      // the OLD un-folded behavior) — repeated here, standalone, as the canonical pin for this
      // exact motivating shape now that both PRIMARY and STRETCH are landed.
      const code = `let a, b, c;\na = 1;\nb = a + 3;\nc = b + 4;\nconsole.log(c);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out.trim()).toBe('console.log(8n);');
    });

    it('the same chain with INLINE initializers collapses via PRIMARY alone (no predeclaration involved)', () => {
      const out = tsPartialEval(`let a = 1; let b = a + 3; let c = b + 4; console.log(c);`, 'f.ts');

      expect(out).not.toContain('let a');
      expect(out).not.toContain('let b');
      expect(out).not.toContain('let c');
      expect(out.trim()).toBe('console.log(8n);');
    });

    it('var behaves the same way as let', () => {
      const out = tsPartialEval(`var a = 1; var b = a + 3; console.log(b);`, 'f.ts');

      expect(out).not.toContain('var a');
      expect(out).not.toContain('var b');
      expect(out.trim()).toBe('console.log(4n);');
    });

    it('reassigned exactly TWICE anywhere (even far apart) stays completely untouched (regression guard)', () => {
      const code = `let x = 1n;\nconsole.log(x);\nx = 2n;\nconsole.log(x);\nx = 3n;\nconsole.log(x);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out.trim()).toBe(code);
    });

    it('reassigned exactly ONCE, but INSIDE an if/loop/function — stays completely untouched (a syntactic "any write anywhere" check, not reachability)', () => {
      const ifCase = tsPartialEval(
        `let x = 1n;\nfunction f(cond) {\n  if (cond) { x = 2n; }\n}\nf(true);\nconsole.log(x);`,
        'f.ts',
      );

      expect(ifCase).toContain('let x = 1n;');
      expect(ifCase).toContain('x = 2n;');
      expect(ifCase).toContain('console.log(x);');
      expect(ifCase).not.toMatch(/console\.log\(1n\)/);

      const loopCase = tsPartialEval(
        `let total = 1n;\nfor (let i = 0n; i < 3n; i++) {\n  total = total + i;\n}\nconsole.log(total);`,
        'f.ts',
      );

      // The loop unrolls (an unrelated, pre-existing feature), but `total` is written 3 times
      // by the unrolled body's own source shape (once per loop-body copy in the ORIGINAL,
      // pre-unroll source) — never treated as effectively const, so its declaration survives.
      expect(loopCase).toContain('let total = 1n;');

      const functionCase = tsPartialEval(
        `let a = 1n;\nfunction mut() {\n  a = 2n;\n}\nmut();\nconsole.log(a);`,
        'f.ts',
      );

      expect(functionCase).toContain('let a = 1n;');
      expect(functionCase).toContain('a = 2n;');
      expect(functionCase).toContain('console.log(a);');
    });

    it("shadowing: an inner function's own same-named let, reassigned inside that inner scope, does not disqualify the OUTER effectively-const variable — and the inner reassignment is never resolved against the OUTER value", () => {
      const code = `let a = 1n;\nfunction f() {\n  let a = 2n;\n  a = 3n;\n  return a;\n}\nconsole.log(a);`;
      const out = tsPartialEval(code, 'f.ts');

      // The inner (shadowed) declaration/reassignment are untouched by THIS (top-level) pass.
      expect(out).toContain('let a = 2n;');
      // The final inner read is never substituted against the OUTER effectively-const value
      // (`1n`) — the LATER, local (per-function) pass separately resolves the inner
      // reassignment chain to its OWN correct value, `3n` (see the "LOCAL, per-function
      // constant propagation" describe block below for that dedicated coverage).
      expect(out).toContain('return 3n;');
      expect(out).not.toContain('return 1n;');
      // The OUTER (unshadowed) read correctly resolves to the outer effectively-const value.
      expect(out).toContain('console.log(1n);');
    });

    it('interaction with while-loop unrolling: a genuine "let i = <const>; while (...) { ...; i++; }" counter still unrolls exactly as before, untouched by this feature', () => {
      const code = `let sum = 0n;\nlet i = 0n;\nwhile (i < 5n) { sum = sum + i; i = i + 1n; }`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).not.toContain('while (');
      expect(out).not.toContain('let i');
      for (const i of [0, 1, 2, 3, 4]) expect(out).toContain(`sum = sum + ${i}n;`);
    });
  });

  describe('STRETCH: let x; x = <init>; (declare-then-assign-once)', () => {
    it('a single predeclared name resolves and its declare+assign PAIR is eliminated together', () => {
      const out = tsPartialEval(`let x;\nx = 5n;\nconsole.log(x);`, 'f.ts');

      expect(out.trim()).toBe('console.log(5n);');
    });

    it('the multi-declarator predeclaration form (let a, b, c;) resolves each name independently, via its own later top-level assignment', () => {
      const out = tsPartialEval(`let a, b, c;\na = 1n;\nb = a + 3n;\nc = b + 4n;\nconsole.log(c);`, 'f.ts');

      expect(out.trim()).toBe('console.log(8n);');
    });

    it('the multi-declarator form with ONE name assigned inside a conditional disqualifies only that name, not the others', () => {
      const code = [
        'let a, b, c;',
        'a = 1n;',
        'function f(cond) {',
        '  if (cond) { b = 2n; }',
        '}',
        'f(true);',
        'c = a + 4n;',
        'console.log(a);',
        'console.log(b);',
        'console.log(c);',
      ].join('\n');
      const out = tsPartialEval(code, 'f.ts');

      // `a` and `c` fully resolve (their sole assignments are direct, unconditional top-level
      // statements) — their declarations/assignments are gone, their reads substituted.
      expect(out).not.toContain('a = 1n');
      expect(out).not.toContain('c = a');
      expect(out).toContain('console.log(1n);'); // a
      expect(out).toContain('console.log(5n);'); // c = a + 4n = 5n

      // `b`'s sole write is nested inside an `if` inside a function — never a direct,
      // unconditional top-level statement — so `b` is never resolved, and its (still-live)
      // predeclaration/assignment/read all survive untouched.
      expect(out).toContain('let b;');
      expect(out).toContain('b = 2n;');
      expect(out).toContain('console.log(b);');
    });

    it('assigned twice total (even both at the top level) stays completely untouched — the "exactly one write" rule, not merely "one qualifying top-level assignment found"', () => {
      const code = `let a;\na = 1n;\na = 2n;\nconsole.log(a);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out.trim()).toBe(code);
    });

    it('bails when the predeclaration and its assignment are NOT both direct, unconditional statements of the SAME top-level statement list', () => {
      const nestedAssign = tsPartialEval(
        `let x;\nfunction f(cond) {\n  if (cond) { x = 1n; }\n}\nf(true);\nconsole.log(x);`,
        'f.ts',
      );

      expect(nestedAssign).toContain('let x;');
      expect(nestedAssign).toContain('x = 1n;');
      expect(nestedAssign).toContain('console.log(x);');
    });

    it('interaction with while-loop unrolling: a no-initializer predeclaration is never mistaken for the while-counter idiom (which requires an initializer on its own preceding declaration) — and a real counter with an initializer is unaffected either way', () => {
      // `tryUnrollCountingWhile`'s own `prev` shape requires `decl.initializer` — a bare
      // `let i;` predeclaration never matches it regardless of this feature. This pins that
      // there's no accidental interference in either direction: the while still unrolls via
      // the EXISTING mechanism, exactly as it does without any predeclaration involved.
      const code = `let sum = 0n;\nlet i = 0n;\nwhile (i < 3n) { sum = sum + i; i++; }`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).not.toContain('while (');
      expect(out).not.toContain('let i');
      for (const i of [0, 1, 2]) expect(out).toContain(`sum = sum + ${i}n;`);
    });

    it('a read positioned BETWEEN a STRETCH predeclaration and its sole resolving assignment blocks folding (soundness regression guard)', () => {
      // `let x;` genuinely makes `x` observable as `undefined` from that point on — a real,
      // distinct value from whatever it's later assigned. Folding here would let
      // constPropagationTransformer (order-blind, file-wide) replace the FIRST console.log's
      // read with the value `x` only receives afterward.
      const code = `let x;\nconsole.log(x);\nx = 5n;\nconsole.log(x);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out.trim()).toBe(code);
    });

    it('a read of one still-pending STRETCH name from inside an unrelated statement disqualifies just that name, not siblings resolved cleanly', () => {
      const code = ['let x;', 'let y;', 'let z = x;', 'x = 1n;', 'y = 2n;', 'console.log(x, y, z);'].join('\n');
      const out = tsPartialEval(code, 'f.ts');

      // `x` is read (via `z`'s initializer) before its own resolving assignment — disqualified.
      expect(out).toContain('let x;');
      expect(out).toContain('x = 1n;');
      // `y` has no intervening read anywhere and folds normally.
      expect(out).not.toContain('let y;');
      expect(out).not.toContain('y = 2n;');
      expect(out).toContain('console.log(x, 2n, z);');
    });

    it('an intervening read inside a nested function body (called later, not between the two statements at runtime) still conservatively disqualifies folding', () => {
      const code = ['let x;', 'function f() { return x; }', 'x = 5n;', 'console.log(f());'].join('\n');
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('let x;');
      expect(out).toContain('x = 5n;');
      expect(out).toContain('return x;');
    });
  });

  describe('write-detection: reusing an EXISTING top-level let/var as a for-of/for-in loop target is a WRITE, not a read', () => {
    // Regression guard: `collectWriteCounts`'s ForIn/ForOf branch must treat a REUSED (not
    // freshly `let`/`const`/`var`-declared) loop head as a write to that binding on every
    // iteration — otherwise it's reported as written zero times, gets folded into `consts`,
    // and `constPropagationTransformer` then substitutes the loop head's own target with the
    // stale pre-loop literal.
    it('for (x of arr) — plain identifier reuse', () => {
      const code = `let x = 1n;\nconsole.log(x);\nfor (x of [10n, 20n, 30n]) {\n  console.log(x);\n}\nconsole.log(x);`;
      const out = tsPartialEval(code, 'f.ts');

      // The declaration survives untouched (never folded into `consts`)...
      expect(out).toContain('let x = 1n;');
      // ...and every read — including the loop head's own binding — stays a live reference to
      // `x`, never substituted with the stale pre-loop literal `1n`.
      expect(out).toContain('for (x of [10n, 20n, 30n])');
      expect(out.match(/console\.log\(x\)/g)).toHaveLength(3);
      expect(out).not.toMatch(/console\.log\(1n\)/);
    });

    it('for (k in obj) — plain identifier reuse', () => {
      const code = `let k = 1n;\nfor (k in [10n, 20n]) {\n  console.log(k);\n}\nconsole.log(k);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('let k = 1n;');
      expect(out).toContain('for (k in [10n, 20n])');
      expect(out.match(/console\.log\(k\)/g)).toHaveLength(2);
      expect(out).not.toMatch(/console\.log\(1n\)/);
    });

    it('the STRETCH declare-then-assign-once idiom feeding a for-of target is also left untouched', () => {
      const code = `let x;\nx = 1n;\nfor (x of [10n, 20n, 30n]) {\n  console.log(x);\n}\nconsole.log(x);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('let x;');
      expect(out).toContain('x = 1n;');
      expect(out).toContain('for (x of [10n, 20n, 30n])');
      expect(out.match(/console\.log\(x\)/g)).toHaveLength(2);
      expect(out).not.toMatch(/console\.log\(1n\)/);
    });

    it('array-destructuring reuse: for ([x, y] of pairs)', () => {
      const code = `let x = 1n;\nlet y = 2n;\nfor ([x, y] of [[10n, 20n]]) {\n  console.log(x, y);\n}\nconsole.log(x, y);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('let x = 1n;');
      expect(out).toContain('let y = 2n;');
      expect(out).toContain('for ([x, y] of [[10n, 20n]])');
      expect(out.match(/console\.log\(x, y\)/g)).toHaveLength(2);
    });

    it('object-destructuring reuse: for ({val: x} of arr)', () => {
      const code = `let x = 1n;\nfor ({val: x} of [{val: 10n}]) {\n  console.log(x);\n}\nconsole.log(x);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('let x = 1n;');
      expect(out.match(/console\.log\(x\)/g)).toHaveLength(2);
      expect(out).not.toMatch(/console\.log\(1n\)/);
    });

    it('a FRESH declaration as the loop target (for (let x of arr)) is unaffected — only reuse of an existing binding is in scope here', () => {
      const code = `let total = 0n;\nfor (let x of [1n, 2n]) {\n  total = total + x;\n}\nconsole.log(total);`;
      const out = tsPartialEval(code, 'f.ts');

      // `x` here is a fresh per-loop declaration, never a top-level candidate — untouched by
      // this feature either way; `total` is written inside the loop body so it also survives.
      expect(out).toContain('for (let x of');
      expect(out).toContain('let total = 0n;');
    });
  });
});

// ── tsPartialEval (array/object lookup-table folding) ──
//
// A top-level `const NAME = [...]` / `const NAME = {...}` whose every element/property folds
// to a bigint (the SAME `tsEvalConst`/`consts` machinery the scalar consts above already use)
// AND whose every use anywhere in the file is a plain, unshadowed, non-write, non-call
// constant-indexed read (`NAME[k]`/`NAME.prop`/`NAME["prop"]`) is folded the same way a scalar
// const's read is — each resolvable access becomes its literal element/property value, and the
// now-fully-dead declaration is removed by the SAME dead-declaration-elimination pass. A SINGLE
// disqualifying use anywhere (reachable or not) rules out the WHOLE table — never partial
// folding of an otherwise-safe access elsewhere in the same table.
describe('tsPartialEval (array/object lookup-table folding)', () => {
  it('a const array with a constant-index read folds to its literal element, and the now-dead declaration is removed', () => {
    const out = tsPartialEval(`const FEES = [500n, 3000n, 10000n];\nconsole.log(FEES[1n]);`, 'f.ts');

    expect(out).not.toContain('const FEES');
    expect(out.trim()).toBe('console.log(3000n);');
  });

  it('a const object folds both a plain property read AND a computed-string-key read, declaration removed once dead', () => {
    const out = tsPartialEval(
      `const TIERS = { low: 10n, high: 200n };\nconsole.log(TIERS.low);\nconsole.log(TIERS["high"]);`,
      'f.ts',
    );

    expect(out).not.toContain('const TIERS');
    expect(out).toContain('console.log(10n);');
    expect(out).toContain('console.log(200n);');
  });

  it('a non-constant (parameter-derived) index is left untouched, and does NOT disqualify other, provably-resolvable accesses of the same array', () => {
    const out = tsPartialEval(
      `const FEES = [1n, 2n, 3n];\nfunction f(i) { return FEES[i]; }\nconsole.log(FEES[0n]);`,
      'f.ts',
    );

    expect(out).toContain('FEES[i]'); // non-constant — left untouched
    expect(out).toContain('console.log(1n);'); // the OTHER, resolvable access still folds
    expect(out).toContain('const FEES'); // still referenced by the unresolvable access — kept
  });

  it('an out-of-bounds constant index is left untouched, and does NOT disqualify an in-bounds access elsewhere', () => {
    const out = tsPartialEval(`const FEES = [1n, 2n];\nconsole.log(FEES[5n]);\nconsole.log(FEES[0n]);`, 'f.ts');

    expect(out).toContain('FEES[5n]'); // out of bounds — left untouched
    expect(out).toContain('console.log(1n);'); // the in-bounds access still folds
  });

  it('a negative constant index is left untouched (not a valid array index), and does not disqualify other accesses', () => {
    const out = tsPartialEval(`const FEES = [1n, 2n];\nconsole.log(FEES[-1n]);\nconsole.log(FEES[0n]);`, 'f.ts');

    expect(out).toContain('FEES[-1n]');
    expect(out).toContain('console.log(1n);');
  });

  it('an unresolvable computed-key read on an object table (non-string-literal key) is left untouched, and does not disqualify a resolvable read elsewhere', () => {
    const out = tsPartialEval(
      `const TIERS = { low: 10n };\nfunction f(k) { return TIERS[k]; }\nconsole.log(TIERS.low);`,
      'f.ts',
    );

    expect(out).toContain('TIERS[k]');
    expect(out).toContain('console.log(10n);');
  });

  it('a table whose only disqualifying use sits in an unreachable if(false) branch is still disqualified — the safety scan runs on the PRE-fold source, not reachability-aware', () => {
    const code = `const ARR = [1n, 2n];\nif (false) { ARR.push(1n); }\nconsole.log(ARR[0n]);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('const ARR = [1n, 2n];'); // never tracked — declaration survives
    expect(out).toContain('console.log(ARR[0n]);'); // NOT folded to 1n
    expect(out).not.toContain('ARR.push'); // the dead branch itself is still pruned by foldTransformer
  });

  describe('class/namespace/enum bodies are not silently skipped by the safety scan', () => {
    // `isOutOfScopeForPropagation` treats a whole class/enum/namespace as "safe, don't even
    // descend" — correct for the scalar-const propagation passes (you can't mutate a const
    // scalar's VALUE without illegally reassigning its binding, already a hard error) but NOT
    // for a tracked array/object table: a class method or namespace function can mutate the
    // table without ever reassigning the table's own binding. `checkTableSafety` must not reuse
    // that blanket skip. (These shapes are independently rejected by the real `compile()`
    // pipeline regardless — see the `compile()` sibling test below — but `tsPartialEval` is a
    // separately exported function, so the scan must fail closed on its own too.)
    it('a class method mutating a tracked array via .push() disqualifies the whole table', () => {
      const code = `
        const ARR = [1n, 2n, 3n];
        class Foo {
          mutate() {
            ARR.push(99n);
          }
        }
        console.log(ARR[0n]);
      `;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const ARR = [1n, 2n, 3n];');
      expect(out).toContain('console.log(ARR[0n]);'); // NOT folded to 1n
    });

    it('a class method writing through an element access (NAME[k] = ...) disqualifies the whole table', () => {
      const code = `
        const ARR = [1n, 2n];
        class Foo {
          mutate() {
            ARR[0n] = 99n;
          }
        }
        console.log(ARR[0n]);
      `;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const ARR = [1n, 2n];');
      expect(out).toContain('console.log(ARR[0n]);'); // NOT folded to 1n
    });

    it('a namespace function mutating a tracked array disqualifies the whole table the same way', () => {
      const code = `
        const ARR = [1n, 2n];
        namespace NS {
          export function mutate() {
            ARR[0n] = 99n;
          }
        }
        console.log(ARR[0n]);
      `;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const ARR = [1n, 2n];');
      expect(out).toContain('console.log(ARR[0n]);'); // NOT folded to 1n
    });

    it('an enum member initializer referencing a tracked array disqualifies the whole table', () => {
      const code = `
        const ARR = [1n, 2n];
        enum E {
          A = ARR.length,
        }
        console.log(ARR[0n]);
      `;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const ARR = [1n, 2n];');
      expect(out).toContain('console.log(ARR[0n]);'); // NOT folded to 1n
    });

    it('sanity check: a class elsewhere in the file that never references the tracked name at all does not disqualify it — this is a name-scoped guard, not "any class anywhere"', () => {
      const code = `
        const ARR = [1n, 2n];
        class Unrelated {
          method() {
            return 42n;
          }
        }
        console.log(ARR[0n]);
      `;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).not.toContain('const ARR');
      expect(out).toContain('console.log(1n);');
    });
  });

  describe('disqualification — any ONE use anywhere disqualifies the WHOLE table, even otherwise-safe accesses', () => {
    it('reassignment of the identifier disqualifies every access', () => {
      const code = `const ARR = [1n, 2n];\nARR = [3n];\nconsole.log(ARR[0n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const ARR = [1n, 2n];');
      expect(out).toContain('ARR = [3n];');
      expect(out).toContain('console.log(ARR[0n]);'); // NOT folded to 1n
    });

    it('a method call on the identifier disqualifies every access, regardless of method name (no whitelist)', () => {
      const code = `const ARR = [1n, 2n];\nARR.push(3n);\nconsole.log(ARR[0n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const ARR = [1n, 2n];');
      expect(out).toContain('ARR.push(3n);');
      expect(out).toContain('console.log(ARR[0n]);'); // NOT folded to 1n
    });

    it('an element-access used as an assignment target disqualifies every access, including OTHER indices', () => {
      const code = `const ARR = [1n, 2n];\nARR[0n] = 5n;\nconsole.log(ARR[1n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('const ARR = [1n, 2n];');
      expect(out).toContain('ARR[0n] = 5n;');
      expect(out).toContain('console.log(ARR[1n]);'); // NOT folded to 2n
    });

    it('passing the identifier as a bare call argument disqualifies every access', () => {
      const code = `const ARR = [1n, 2n];\nconsole.log(ARR);\nconsole.log(ARR[0n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('console.log(ARR);');
      expect(out).toContain('console.log(ARR[0n]);'); // NOT folded to 1n
    });

    it('aliasing the identifier to another variable disqualifies every access', () => {
      const code = `const ARR = [1n, 2n];\nlet other = ARR;\nconsole.log(ARR[0n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('let other = ARR;');
      expect(out).toContain('console.log(ARR[0n]);');
    });

    it('spreading the identifier disqualifies every access', () => {
      const code = `const ARR = [1n, 2n];\nfunction f(...args) { return 1n; }\nf(...ARR);\nconsole.log(ARR[0n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('f(...ARR);');
      expect(out).toContain('console.log(ARR[0n]);');
    });

    it('returning the identifier from a function disqualifies every access', () => {
      const code = `const ARR = [1n, 2n];\nfunction f() { return ARR; }\nconsole.log(ARR[0n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('return ARR;');
      expect(out).toContain('console.log(ARR[0n]);');
    });

    it('a property/element access reused as a destructuring-assignment target (nested inside the pattern) disqualifies every access', () => {
      // `({ x: ARR[0n] } = obj)` — TypeScript parses a destructuring-assignment pattern with the
      // SAME node kinds as an ordinary object-literal VALUE; only climbing up to the outermost
      // `=` tells them apart. ARR[0n] here is a WRITE target (obj.x's value lands in ARR[0]).
      const code = `const ARR = [1n, 2n];\nlet obj = { x: 5n };\n({ x: ARR[0n] } = obj);\nconsole.log(ARR[1n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('({ x: ARR[0n] } = obj);');
      expect(out).toContain('console.log(ARR[1n]);'); // NOT folded to 2n
    });

    it('a PARENTHESIZED update-expression target still disqualifies (an AST parent field points at the wrapping ParenthesizedExpression, not the access itself)', () => {
      const code = `const ARR = [1n, 2n];\n(ARR[0n])++;\nconsole.log(ARR[1n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('(ARR[0n])++;');
      expect(out).toContain('console.log(ARR[1n]);'); // NOT folded to 2n
    });

    it('a PARENTHESIZED call callee still disqualifies', () => {
      const code = `const ARR = [1n, 2n];\n(ARR[0n])();\nconsole.log(ARR[1n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('(ARR[0n])();');
      expect(out).toContain('console.log(ARR[1n]);'); // NOT folded to 2n
    });

    it('a PARENTHESIZED destructuring-assignment target nested inside the pattern still disqualifies', () => {
      const code = `const ARR = [1n, 2n];\nlet obj = { x: 5n };\n({ x: (ARR[0n]) } = obj);\nconsole.log(ARR[1n]);`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('({ x: (ARR[0n]) } = obj);');
      expect(out).toContain('console.log(ARR[1n]);'); // NOT folded to 2n
    });
  });

  it('a same-named local array in an inner function scope is a DIFFERENT binding — shadowing keeps it from being confused with the outer tracked table', () => {
    const code = `
      const ARR = [1n, 2n];
      function f() {
        const ARR = [9n, 8n];
        ARR.push(1n); // disqualifies only the INNER (shadowed) ARR
        return ARR[0n];
      }
      console.log(ARR[0n]);
    `;
    const out = tsPartialEval(code, 'f.ts');

    // The inner, shadowed ARR (mutated via push) is left completely untouched.
    expect(out).toContain('const ARR = [9n, 8n];');
    expect(out).toContain('ARR.push(1n);');
    expect(out).toContain('return ARR[0n];');
    // The OUTER (unshadowed, never mutated) table's read still resolves...
    expect(out).toContain('console.log(1n);');
    // ...but its declaration is conservatively KEPT: dead-elimination is a flat, whole-file
    // textual Identifier count (not scope-aware — same documented behavior as the scalar-const
    // shadowing test above), and the inner shadowing declaration/uses of the same name "ARR"
    // are enough to (harmlessly) keep the outer `const ARR = [1n, 2n];` around even though its
    // one real (unshadowed) read was already inlined.
    expect(out).toContain('const ARR = [1n, 2n];');
  });

  it('a same-named `let` FIRST introduced INSIDE an if-branch shadows a top-level table for a read AFTER the branch too — mirrors the scalar-const fix, ported to table-fold', () => {
    // Regression: `checkTableSafety`/`tableFoldTransformer`'s own shadow computation (like
    // `foldTransformer`'s, above) only ever called `collectVarNames` (var-hoisted names only),
    // never `collectLexicalNamesInScope` — so a table name FIRST `let`-declared inside a nested
    // if/while branch was invisible to it once control passed the branch's closing brace. A
    // table access in a SIBLING statement after the branch was then wrongly treated as an
    // unshadowed read of the OUTER top-level table by BOTH the safety scan and the fold itself.
    const arrayCode = `const TABLE = [10n, 20n, 30n];\nfunction f(cond) {\n  if (cond) {\n    let TABLE = [1n, 2n, 3n];\n  }\n  return TABLE[1n] + 0n;\n}`;
    const arrayOut = tsPartialEval(arrayCode, 'f.ts');

    expect(arrayOut).toContain('return TABLE[1n] + 0n;'); // NOT folded to `20n + 0n;`
    expect(arrayOut).not.toContain('20n + 0n');

    const objectCode = `const RATE = { a: 1n, b: 2n };\nfunction f(cond) {\n  if (cond) {\n    let RATE = { a: 99n, b: 99n };\n  }\n  return RATE.a;\n}`;
    const objectOut = tsPartialEval(objectCode, 'f.ts');

    expect(objectOut).toContain('return RATE.a;'); // NOT folded to `1n;`
    expect(objectOut).not.toContain('return 1n;');
  });

  it('a nested array/object literal ("a table of tables") is never a candidate — left completely untouched (explicitly out of scope)', () => {
    const code = `const TBL = [[1n, 2n], [3n, 4n]];\nconsole.log(TBL[0n]);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('const TBL = [[1n, 2n], [3n, 4n]];');
    expect(out).toContain('console.log(TBL[0n]);');
  });

  it('a spread element inside the literal itself is never a candidate — left completely untouched', () => {
    const code = `const other = [9n];\nconst ARR = [...other, 1n];\nconsole.log(ARR[1n]);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('const ARR = [...other, 1n];');
    expect(out).toContain('console.log(ARR[1n]);');
  });

  it('an object literal with shorthand/spread/computed properties is never a candidate — left completely untouched', () => {
    const code = `const k = 1n;\nconst OBJ = { k, ...{}, [1]: 2n };\nconsole.log(OBJ.k);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('console.log(OBJ.k);'); // not folded — OBJ was never a candidate
  });

  it('`new Array(n)` — a completely different, heap-allocated SauceScript concept — is never treated as a lookup table', () => {
    const code = `const arr = new Array(3n);\narr[0] = 1n;\nconsole.log(arr[0]);`;
    const out = tsPartialEval(code, 'f.ts');

    expect(out).toContain('new Array(3n)');
    expect(out).toContain('console.log(arr[0]);');
  });

  it('a resolved read used as an ordinary call argument (a derived SCALAR, not the array/object itself) is safe and still folds', () => {
    const out = tsPartialEval(
      `const FEES = [1n, 2n, 3n];\nfunction useFee(x) { return x; }\nconsole.log(useFee(FEES[0n]));`,
      'f.ts',
    );

    expect(out).not.toContain('const FEES');
    expect(out).toContain('console.log(useFee(1n));');
  });

  it('a table element/property may itself reference an earlier scalar top-level const', () => {
    const out = tsPartialEval(`const BASE = 100n;\nconst FEES = [BASE, BASE + 1n];\nconsole.log(FEES[1n]);`, 'f.ts');

    expect(out).not.toContain('const FEES');
    expect(out).toContain('console.log(101n);');
  });

  it('interacts correctly with loop-unrolling: a table indexed by an unrolled loop counter folds every iteration', () => {
    const out = tsPartialEval(
      `const FEES = [10n, 20n, 30n];\nlet sum = 0n;\nfor (let i = 0n; i < 3n; i++) { sum = sum + FEES[i]; }\nconsole.log(sum);`,
      'f.ts',
    );

    expect(out).not.toContain('for (');
    expect(out).not.toContain('const FEES');
    expect(out).toContain('sum = sum + 10n;');
    expect(out).toContain('sum = sum + 20n;');
    expect(out).toContain('sum = sum + 30n;');
  });

  // ── `for (const x of ARR) {...}` unrolling over a tracked ARRAY table (stretch goal) ──
  //
  // Reuses the exact same safety infrastructure as the numeric for/while unroller
  // (MAX_UNROLL_ITERATIONS, bodyBlocksUnrolling's break/continue/return/shadowing bail,
  // substituteCounter) adapted to iterate over the table's ELEMENTS instead of an arithmetic
  // sequence. Iterating an array table is itself always a safe, read-only use (its elements are
  // immutable bigints, no aliasing risk) — so `for...of` usage never disqualifies the table from
  // its OTHER index/property folding, independent of whether this specific loop shape is one the
  // unroller can actually expand.
  describe('for-of unrolling over a tracked array table (stretch goal)', () => {
    it('unrolls a basic for-of over a tracked array, substituting the loop variable with each literal element', () => {
      const out = tsPartialEval(
        `const FEES = [10n, 20n, 30n];\nlet sum = 0n;\nfor (const fee of FEES) { sum = sum + fee; }\nconsole.log(sum);`,
        'f.ts',
      );

      expect(out).not.toContain('for (');
      expect(out).not.toContain('const FEES');
      expect(out).toContain('sum = sum + 10n;');
      expect(out).toContain('sum = sum + 20n;');
      expect(out).toContain('sum = sum + 30n;');
    });

    it('bails (leaves the for-of as real runtime code, keeps the declaration) when the body contains break/continue/return', () => {
      for (const escape of ['break;', 'continue;', 'return sum;']) {
        const out = tsPartialEval(
          `function f() {\n  const FEES = [10n, 20n, 30n];\n  let sum = 0n;\n  for (const fee of FEES) { if (fee === 20n) { ${escape} } sum = sum + fee; }\n  return sum;\n}`,
          'f.ts',
        );

        expect(out).toContain('for (const fee of FEES)');
        expect(out).toContain('const FEES');
      }
    });

    it('bails (leaves the for-of as real runtime code) when the body shadows the loop variable name', () => {
      const out = tsPartialEval(
        `const FEES = [10n, 20n];\nlet sum = 0n;\nfor (const fee of FEES) { let fee = 99n; sum = sum + fee; }\nconsole.log(sum);`,
        'f.ts',
      );

      expect(out).toContain('for (const fee of FEES)');
      expect(out).toContain('const FEES');
    });

    it('bails (leaves the for-of as real runtime code) when the body declares its OWN per-iteration local — same crash class as the numeric for/while unroller (splicing N copies of the body directly into the enclosing list would otherwise duplicate a non-loop-variable `let`/`const`)', () => {
      const out = tsPartialEval(
        `const TABLE = [10n, 20n, 30n];\nlet total = 0n;\nfor (const x of TABLE) { let doubled = x * 2n; total = total + doubled; }`,
        'f.ts',
      );

      expect(out).toContain('for (const x of TABLE)');
      expect(out).toContain('const TABLE');
      expect(out.match(/let doubled/g)?.length).toBe(1);
    });

    it('a for-of iteration over a table does not disqualify its OTHER, independent index-access reads elsewhere', () => {
      const out = tsPartialEval(
        `const FEES = [10n, 20n];\nlet sum = 0n;\nfor (const fee of FEES) { sum = sum + fee; }\nconsole.log(FEES[0n]);\nconsole.log(sum);`,
        'f.ts',
      );

      expect(out).not.toContain('for (');
      expect(out).not.toContain('const FEES');
      expect(out).toContain('console.log(10n);'); // FEES[0n]
      expect(out).toContain('sum = sum + 10n;');
      expect(out).toContain('sum = sum + 20n;');
    });

    it('a destructured loop variable (`for (const [a] of ARR)`) is left un-unrolled — the table is still tracked (iteration alone is safe) but this loop shape is declined', () => {
      const code = `const PAIRS = [1n, 2n];\nfor (const [a] of PAIRS) {\n  console.log(a);\n}`;
      const out = tsPartialEval(code, 'f.ts');

      expect(out).toContain('for (const [a] of PAIRS)');
      expect(out).toContain('const PAIRS = [1n, 2n];');
    });

    it('declines to unroll a for-of whose table exceeds MAX_UNROLL_ITERATIONS (256), leaving the loop and declaration as real runtime code — the SAME cap the numeric for/while unroller reuses', () => {
      const elements = Array.from({ length: 257 }, (_, i) => `${i}n`).join(', ');
      const out = tsPartialEval(
        `const FEES = [${elements}];\nlet sum = 0n;\nfor (const fee of FEES) { sum = sum + fee; }\nconsole.log(sum);`,
        'f.ts',
      );

      expect(out).toContain('for (const fee of FEES)');
      expect(out).toContain('const FEES');
    });

    it('cascades: a for-of unrolled inside an already-unrolled numeric for loop fully resolves both to straight-line arithmetic', () => {
      const out = tsPartialEval(
        `const FEES = [1n, 2n];\nlet sum = 0n;\nfor (let i = 0n; i < 2n; i++) {\n  for (const fee of FEES) { sum = sum + fee + i; }\n}\nconsole.log(sum);`,
        'f.ts',
      );

      expect(out).not.toContain('for (');
      expect(out).not.toContain('const FEES');
      // i=0: fee=1,2 → "+ 1n + 0n", "+ 2n + 0n"; i=1: "+ 1n + 1n", "+ 2n + 1n"
      for (const [fee, i] of [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1],
      ]) {
        expect(out).toContain(`sum + ${fee}n + ${i}n`);
      }
    });
  });
});

// ── compile() integration: the wiring (processor/index.ts import path + index.ts top-level) ──

let tmpDir: string;

function writeMod(name: string, code: string): void {
  fs.writeFileSync(path.join(tmpDir, name), code);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-ts-frontend-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const targets: CompileTarget[] = ['v1', 'v12'];

// A dead branch gated on a TYPED top-level const — the `: boolean` annotation is genuine
// TS-only syntax acorn cannot even PARSE unstripped, so this fixture can only compile at
// all via the built-in front-end (or an equivalent caller-supplied transform). Once
// stripped, `FLAG` is a bare identifier — the SAME shape acorn's own const-eval already
// folds — so this test's point isn't "acorn could never fold this", it's that stripping
// and folding happen correctly together, in the right order, before acorn ever runs.
function typedGateSource(): string {
  return `
    const FLAG: boolean = true;
    export function used() { return 1n; }
    export function unused() { return 999n; }
    export function gate() {
      if (FLAG) { return used(); } else { return unused(); }
    }
  `;
}

describe('ts-frontend compile() integration', () => {
  for (const target of targets) {
    describe(`target ${target}`, () => {
      it('a .sauce.ts import with typed params/return compiles', () => {
        writeMod('m_typed.sauce.ts', `export function addOne(n: bigint): bigint { return n + 1n; }`);
        const source = `
          import { addOne } from "./m_typed";
          function main() { return addOne(2n); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).not.toThrow();
      });

      it('a .sauce.ts import with a typed dead branch folds + treeshakes end to end', () => {
        writeMod('m_gate.sauce.ts', typedGateSource());
        const source = `
          import { gate } from "./m_gate";
          function main() { return gate(); }
        `;

        const result = compile(source, { baseDirs: [tmpDir], target }); // treeshake defaults true

        if (target === 'v1') {
          // main + gate — NOT unused (the dead else-branch, and its call, folded away
          // pre-acorn) — and NOT used either: `used()` is itself a zero-arg, single-`return`,
          // no-nested-call function, so it's vacuously call-foldable ("every argument is a
          // compile-time constant" holds trivially with zero arguments) — the call-folding
          // pass above inlines `used()` directly into `gate`'s own body, so treeshaking drops
          // `used` too, since nothing calls it anymore by the time acorn ever sees the module.
          expect(result.bytecode.length).toBe(2);
        }
      });

      it('a caller-supplied transformModule overriding the built-in strip breaks the same typed fixture', () => {
        writeMod('m_gate_override.sauce.ts', typedGateSource());
        const source = `
          import { gate } from "./m_gate_override";
          function main() { return gate(); }
        `;

        // An identity transform strips nothing — proves the override really replaces the
        // built-in (which is what made the previous test's typed source parseable at all).
        expect(() => compile(source, { baseDirs: [tmpDir], target, transformModule: (code) => code })).toThrow();
      });

      it('a runtime-derived condition in a .sauce.ts import fails closed (no throw, normal branch)', () => {
        writeMod(
          'm_runtime_cond.sauce.ts',
          `export function gate2(n: bigint): bigint {
             if (n === 1n) { return 10n; }
             return 20n;
           }`,
        );
        const source = `
          import { gate2 } from "./m_runtime_cond";
          function main() { return gate2(5n); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).not.toThrow();
      });

      it('a top-level const referenced only inside an imported helper function is baked into its body before the import boundary is crossed — the plain (no ts-frontend) equivalent fails', () => {
        // `collectImportedFunctions` (processor/index.ts) only ever pulls FUNCTION
        // declarations across a source-file import boundary — a module's top-level
        // `const`s are never carried over. So a `.sauce.ts` helper referencing a top-level
        // const can ONLY compile once imported elsewhere if this feature has already baked
        // the value into the function body (and dropped the now-dead declaration) BEFORE
        // that boundary is crossed — this is what actually makes requirement 4 necessary,
        // not just a cosmetic cleanup.
        writeMod('m_rate.sauce.ts', `const RATE = 3n;\nexport function scale(x: bigint): bigint { return x * RATE; }`);
        writeMod('m_rate_plain.sauce', `const RATE = 3n;\nexport function scale(x) { return x * RATE; }`);

        const tsImportSource = `
          import { scale } from "./m_rate";
          function main() { return scale(2n); }
        `;
        const plainImportSource = `
          import { scale } from "./m_rate_plain";
          function main() { return scale(2n); }
        `;

        const result = compile(tsImportSource, { baseDirs: [tmpDir], target });

        if (target === 'v1') {
          expect(result.bytecode.length).toBe(2); // main + scale — RATE was never a function to begin with
        }

        // The plain `.sauce` sibling never runs through ts-frontend at all (no `.ts` suffix),
        // so `scale`'s body still has a bare, now cross-file-unresolvable read of RATE.
        expect(() => compile(plainImportSource, { baseDirs: [tmpDir], target })).toThrow(/undefined variable/);
      });
    });
  }

  it('CompileOptions.tsSource propagates a typed top-level const chain into a bare read, producing bytecode byte-identical to the fully-inlined literal', () => {
    const source = `
      const a: bigint = 1n;
      const b: bigint = a + 3n;
      const c: bigint = b + 4n;
      function main() { return c; }
    `;

    const result = compile(source, { tsSource: true });
    const literal = compile(`function main() { return 8n; }`);

    expect(result.bytecode.length).toBe(1);
    expect(Array.from(result.bytecode[0])).toEqual(Array.from(literal.bytecode[0]));
  });

  it('CompileOptions.tsSource folds the same typed dead branch at the top level', () => {
    const source = typedGateSource().replace(/export /g, '') + `\nfunction main() { return gate(); }`;

    const result = compile(source, { tsSource: true }); // treeshake defaults true; default target v1

    // main + gate — `used()`'s call is ALSO folded away (a zero-arg, single-`return`,
    // no-nested-call function is vacuously call-foldable), so treeshaking drops it too, same
    // as `unused` — see the matching `.sauce.ts` import test above for the full explanation.
    expect(result.bytecode.length).toBe(2);
  });

  it('without tsSource, the identical (untyped) source needs no stripping and folds via acorn itself', () => {
    // Same logic, minus the TS-only type annotation (acorn can parse this directly): the
    // bare `FLAG` identifier condition folds via acorn's OWN const-eval either way — this
    // is the control case showing tsSource is only NEEDED when real TS syntax is present.
    const source =
      typedGateSource()
        .replace(/export /g, '')
        .replace(': boolean', '') + `\nfunction main() { return gate(); }`;

    const result = compile(source); // no tsSource, no baseDirs/import — plain acorn path
    expect(result.bytecode.length).toBe(3);
  });

  it('a countable loop with tsSource compiles to straight-line bytecode — no JUMP_BACK', () => {
    const source = `
      function main() {
        let sum = 0n;
        for (let i = 0n; i < 5n; i++) { sum = sum + i; }
        return sum;
      }
    `;

    const unrolled = compile(source, { tsSource: true });
    const runtime = compile(source); // plain acorn path — a real runtime loop, JUMP_BACK present

    expect(Array.from(runtime.bytecode[0])).toContain(OPS.JUMP_BACK);
    expect(Array.from(unrolled.bytecode[0])).not.toContain(OPS.JUMP_BACK);
  });

  it('a countable loop whose body declares its OWN per-iteration local (not the counter) compiles fine — falls back to a real runtime loop rather than crashing acorn.parse on a duplicated declaration', () => {
    // Regression: before the fix, unrolling spliced N copies of the body — including its own
    // `let doubled = ...;` — directly into the enclosing statement list with no per-iteration
    // Block scope, so `ts.transpileModule`'s printed text had 3 adjacent `let doubled` decls;
    // the very next stage, `acorn.parse`, rejected that with `SyntaxError: Identifier 'doubled'
    // has already been declared`. `unrollCountingLoop` now declines to unroll instead (falls
    // back to the well-tested real-JUMP_BACK-loop path), so this compiles successfully — with
    // its own per-iteration `let` scope intact, exactly like the plain (non-tsSource) pipeline.
    const source = `
      function main() {
        let total = 0n;
        for (let i = 0n; i < 3n; i++) {
          let doubled = i * 2n;
          total = total + doubled;
        }
        return total;
      }
    `;

    expect(() => compile(source, { tsSource: true })).not.toThrow();

    const unrolled = compile(source, { tsSource: true });
    const runtime = compile(source); // plain acorn path — never touched by this bug either way

    expect(Array.from(unrolled.bytecode[0])).toContain(OPS.JUMP_BACK); // declined to unroll
    expect(Array.from(runtime.bytecode[0])).toContain(OPS.JUMP_BACK);
  });

  it('CompileOptions.tsSource unrolls a for-of over a lookup table — a construct plain acorn cannot even PARSE, not just a bytecode-shape difference', () => {
    const source = `
      const FEES = [10n, 20n, 30n];
      function main() {
        let sum = 0n;
        for (const fee of FEES) { sum = sum + fee; }
        return sum;
      }
    `;

    // Unlike the typed-branch/countable-loop cases above, plain acorn doesn't merely compile
    // this LESS efficiently — it has no ForOfStatement handling at all, so it throws outright.
    // The ts-frontend fully eliminates the for-of (and the array literal it iterated) before
    // acorn ever sees this source, which is what makes it compilable at all.
    expect(() => compile(source)).toThrow(/ForOfStatement/);

    const result = compile(source, { tsSource: true });

    expect(result.bytecode.length).toBe(1);
    expect(Array.from(result.bytecode[0])).not.toContain(OPS.JUMP_BACK);
  });

  it('a for-of over a table exceeding MAX_UNROLL_ITERATIONS fails to compile even WITH tsSource — unlike the numeric for/while unroller (which falls back to real JUMP_BACK bytecode past its cap), a declined for-of has no runtime fallback at all: acorn cannot parse ForOfStatement, so this is a hard compile failure, not merely a less-optimal one', () => {
    const elements = Array.from({ length: 257 }, (_, i) => `${i}n`).join(', ');
    const source = `
      const FEES = [${elements}];
      function main() {
        let sum = 0n;
        for (const fee of FEES) { sum = sum + fee; }
        return sum;
      }
    `;

    expect(() => compile(source, { tsSource: true })).toThrow(/ForOfStatement/);
  });

  it('a countable while loop with tsSource compiles to straight-line bytecode — no JUMP_BACK', () => {
    const source = `
      function main() {
        let sum = 0n;
        let i = 0n;
        while (i < 5n) { sum = sum + i; i = i + 1n; }
        return sum;
      }
    `;

    const unrolled = compile(source, { tsSource: true });
    const runtime = compile(source); // plain acorn path — a real runtime loop, JUMP_BACK present

    expect(Array.from(runtime.bytecode[0])).toContain(OPS.JUMP_BACK);
    expect(Array.from(unrolled.bytecode[0])).not.toContain(OPS.JUMP_BACK);
  });

  it('CompileOptions.tsSource folds a lookup-table read to bytecode byte-identical to the fully-inlined literal', () => {
    const source = `
      const FEES: bigint[] = [500n, 3000n, 10000n];
      function main() { return FEES[1n]; }
    `;

    const result = compile(source, { tsSource: true });
    const literal = compile(`function main() { return 3000n; }`);

    expect(result.bytecode.length).toBe(1);
    expect(Array.from(result.bytecode[0])).toEqual(Array.from(literal.bytecode[0]));
  });

  it('the LOCAL per-function pass folding a NESTED ternary (locally-known condition) is what makes an otherwise-illegal ternary position compile at all — the base SauceScript grammar only accepts a ternary directly in assignment/declaration position', () => {
    // `(a > 0n ? 2n : 3n)` is NOT itself the whole assignment RHS here — it's nested inside
    // a BinaryExpression (`... + 1n`) — a shape the base (acorn) processor's own
    // `processExpression` rejects outright with "ternary must be used directly in an
    // assignment" whenever a bare ConditionalExpression reaches it. `a > 0n` is resolvable
    // through this pass's own local reasoning (`a` a plain local, not a top-level const), so
    // `localConstPropagationTransformer` eliminates the ternary entirely before acorn ever
    // sees it, and the program compiles.
    const resolvable = `
      function main() {
        let a = 1n;
        let b = (a > 0n ? 2n : 3n) + 1n;
        return b;
      }
    `;

    expect(() => compile(resolvable, { tsSource: true })).not.toThrow();

    const result = compile(resolvable, { tsSource: true });

    // Only `main` — no helper functions — proving the ternary was eliminated rather than,
    // say, hoisted into some fallback runtime representation. (Not compared byte-for-byte to
    // a bare `return 3n;` literal: dead-local-declaration elimination is explicitly out of
    // scope for this pass — see its own "Out of scope, on purpose" note — so `let a = 1n;`
    // is still emitted, just no longer READ; `tsPartialEval`'s own dedicated unit test above
    // already pins the exact folded text, `let b = 3n; return 3n;`.)
    expect(result.bytecode.length).toBe(1);

    // The identical shape, except the condition depends on a genuine runtime parameter — this
    // pass correctly declines to fold it (it can't be resolved), so the raw, still-nested
    // ConditionalExpression reaches acorn unresolved and fails to compile with the SAME error
    // a plain (non-tsSource) ternary-in-illegal-position source would.
    const unresolvable = `
      function main(n: bigint) {
        let b = (n > 0n ? 2n : 3n) + 1n;
        return b;
      }
    `;

    expect(() => compile(unresolvable, { tsSource: true })).toThrow(/ternary must be used directly in an assignment/);
  });

  it('the LOCAL per-function pass folding a ternary passed AS A CALL ARGUMENT is the OTHER illegal-position shape the base grammar names — a ternary "passed as a call argument" is the second shape `processExpression` rejects outright, alongside the nested-BinaryExpression shape pinned above', () => {
    const resolvable = `
      function double(v) {
        return v * 2n;
      }
      function main() {
        let a = 1n;
        let b = double(a > 0n ? 2n : 3n);
        return b;
      }
    `;

    expect(() => compile(resolvable, { tsSource: true })).not.toThrow();

    const result = compile(resolvable, { tsSource: true });

    // Only `main` — `double` is ALSO tsEvalCall-eligible (same-file, single-return,
    // constant argument once the ternary resolves), so the whole chain collapses and no
    // separate helper function survives to be called at runtime.
    expect(result.bytecode.length).toBe(1);

    // The identical shape, except the condition depends on a genuine runtime parameter — this
    // pass correctly declines to fold it, so the raw ConditionalExpression-as-call-argument
    // reaches acorn unresolved and fails with the SAME error the nested-BinaryExpression
    // shape's unresolvable counterpart already throws above.
    const unresolvable = `
      function double(v) {
        return v * 2n;
      }
      function main(n: bigint) {
        return double(n > 0n ? 2n : 3n);
      }
    `;

    expect(() => compile(unresolvable, { tsSource: true })).toThrow(/ternary must be used directly in an assignment/);
  });
});
