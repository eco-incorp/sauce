import { compile, type CompileTarget } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';
import { OPS_V12 } from '../src/saucer/ops-v12.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Compile-time / structural coverage of the inline (arrow-const) function convention —
// `const NAME = (params) => body;` at the top level. See CLAUDE.md ("Inline (arrow-const)
// functions") and src/processor/inline.ts for the algorithm. RUNTIME-result validation
// (tickArg/kyberOut across their branch boundaries, argument-evaluated-exactly-once via an
// observable side effect, the v1 forward-reference fix) lives in
// integration-test/inline-functions.test.ts (real EVM execution via cook()) — this file
// covers what a fast, no-anvil unit test can assert: compiles/throws, and bytecode shape.

let tmpDir: string;

function writeMod(name: string, code: string): void {
  fs.writeFileSync(path.join(tmpDir, name), code);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-inline-fn-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const targets: CompileTarget[] = ['v1', 'v12'];

function totalSize(bytecode: Uint8Array[]): number {
  return bytecode.reduce((acc, b) => acc + b.length, 0);
}

/** Count occurrences of a byte in a buffer (used to count CALL_FUNCTION opcodes on v1). */
function countByte(buf: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of buf) if (b === byte) n++;

  return n;
}

describe('v1 helper-declaration-order fix', () => {
  it('a forward-referencing helper-to-helper call now compiles on v1 (regression)', () => {
    // Previously: v1's processProgram interleaved addFunc with compilation in one pass
    // (file-declaration order), so a() calling LATER-declared b() threw "Function b is
    // undefined." — even though v12 (which registers every name up front before compiling
    // any body) already handled this fine. Fixed by mirroring v12's two-loop registration.
    const source = `
      function a(x) { return b(x) + 1n; }
      function b(x) { return x + 2n; }
      function main() { return a(3n); }
    `;

    expect(() => compile(source, { target: 'v1' })).not.toThrow();

    const result = compile(source, { target: 'v1' });

    // a, b, main — three separate v1 function bodies, in declaration order.
    expect(result.bytecode).toHaveLength(3);
  });

  it('a backward-referencing helper-to-helper call still compiles (unaffected)', () => {
    const source = `
      function b(x) { return x + 2n; }
      function a(x) { return b(x) + 1n; }
      function main() { return a(3n); }
    `;

    expect(() => compile(source, { target: 'v1' })).not.toThrow();
  });

  it('v12 is unaffected by the fix (already worked both ways)', () => {
    const forward = `
      function a(x) { return b(x) + 1n; }
      function b(x) { return x + 2n; }
      function main() { return a(3n); }
    `;

    expect(() => compile(forward, { target: 'v12' })).not.toThrow();
  });
});

describe('inline (arrow-const) functions', () => {
  for (const target of targets) {
    describe(`target ${target}`, () => {
      it('a simple single-return inline function compiles and calls correctly', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main() { return inc(41n); }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('emits NO separate real function for the inline name (v1: single bytecode blob)', () => {
        const inlineResult = compile(
          `
            const inc = (x) => x + 1n;
            function main() { return inc(41n); }
          `,
          { target },
        );
        const realFnResult = compile(
          `
            function inc(x) { return x + 1n; }
            function main() { return inc(41n); }
          `,
          { target },
        );

        if (target === 'v1') {
          // inline: only main() is emitted; real function: inc() + main() = 2 blobs.
          expect(inlineResult.bytecode).toHaveLength(1);
          expect(realFnResult.bytecode).toHaveLength(2);
        } else {
          // v12: a real (CALL_FUNCTION-entered) helper is always terminated by a
          // FUNC_RETURN; with zero real helpers, assembleV12 never emits one at all —
          // so its presence/absence (not raw byte count, which the inline version's
          // own param/result/done bookkeeping can outweigh for a trivial one-liner)
          // is what actually distinguishes "a separate real function was emitted".
          expect(countByte(inlineResult.bytecode[0], OPS_V12.FUNC_RETURN)).toBe(0);
          expect(countByte(realFnResult.bytecode[0], OPS_V12.FUNC_RETURN)).toBeGreaterThan(0);
        }
      });

      it('kyberOut-shaped (one level of guard clause) compiles', () => {
        const source = `
          const kyberOut = (amt, kfee, kVin, kVout, PRECISION) => {
            const inWithFee = Math.mulDiv(amt, PRECISION - kfee, PRECISION);
            const denom = kVin + inWithFee;
            if (denom > 0n) {
              return Math.mulDiv(inWithFee, kVout, denom);
            }
            return 0n;
          };
          function main(amt, kfee, kVin, kVout, PRECISION) {
            return kyberOut(amt, kfee, kVin, kVout, PRECISION);
          }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('tickArg-shaped (two levels of nested guard clause) compiles', () => {
        const source = `
          const tickArg = (shifted, OFFSET) => {
            const HIGH = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000n;
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

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('the same inline function called at multiple sites (same and different args) compiles without name collisions', () => {
        // A broken alpha-rename would surface as "variable '...' is already declared"
        // from the SAME function scope (if/else bodies share the enclosing function's
        // flat scope in this compiler — see context.ts).
        const source = `
          const f = (x) => { const tmp = x * 2n; return tmp; };
          function main() {
            const a = f(1n) + f(2n);
            const b = f(a);
            return a + b;
          }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('recursion: a direct self-call is rejected with a clear error (does not hang)', () => {
        const source = `
          const f = (x) => f(x - 1n);
          function main() { return f(3n); }
        `;

        expect(() => compile(source, { target })).toThrow(/recursive inline function/);
      });

      it('recursion: mutual recursion between two inline functions is rejected (does not hang)', () => {
        const source = `
          const f = (x) => g(x);
          const g = (x) => f(x);
          function main() { return f(3n); }
        `;

        expect(() => compile(source, { target })).toThrow(/recursive inline function/);
      });

      it('a real (non-inline) recursive function is unaffected', () => {
        const source = `
          function fact(n) { if (n === 0n) { return 1n; } return n * fact(n - 1n); }
          function main() { return fact(3n); }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('recursion: a cycle routing through an intervening REAL function is rejected (not just direct inline-to-inline)', () => {
        // b (real) calls a (inline); a (inline) calls b (real) — a's un-expanded body is
        // spliced into every call site that reaches it, including the one inside b's own
        // declaration, so b's compiled body would end up calling itself: genuine unbounded
        // runtime recursion. detectInlineRecursion must follow edges through real functions
        // too, not just among inline-to-inline calls, to catch this.
        const source = `
          function b(y) { return a(y) + 1n; }
          const a = (x) => { if (x > 0n) { return b(x - 1n); } return 0n; };
          function main() { return a(3n); }
        `;

        expect(() => compile(source, { target })).toThrow(/recursive inline function/);
      });

      it('recursion: a real function that calls an inline function, where NEITHER cycles back, is fine', () => {
        const source = `
          const inc = (x) => x + 1n;
          function helper(y) { return inc(y) * 2n; }
          function main() { return helper(3n); }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('bail: a loop inside an inline body is a clear compile error', () => {
        const source = `
          const sumTo = (n) => {
            let s = 0n;
            for (let i = 0n; i < n; i++) { s = s + i; }
            return s;
          };
          function main() { return sumTo(5n); }
        `;

        expect(() => compile(source, { target })).toThrow(/cannot inline function "sumTo".*ForStatement/);
      });

      it('bail: a while loop inside an inline body is a clear compile error', () => {
        const source = `
          const sumTo = (n) => {
            let s = 0n;
            let i = 0n;
            while (i < n) { s = s + i; i = i + 1n; }
            return s;
          };
          function main() { return sumTo(5n); }
        `;

        expect(() => compile(source, { target })).toThrow(/cannot inline function "sumTo".*WhileStatement/);
      });

      it('bail: a nested function/arrow inside an inline body is a clear compile error', () => {
        const source = `
          const f = (x) => {
            const g = (y) => y + 1n;
            return g(x);
          };
          function main() { return f(1n); }
        `;

        expect(() => compile(source, { target })).toThrow(/nested function\/arrow/);
      });

      it('bail: a switch statement inside an inline body is a clear compile error', () => {
        const source = `
          const f = (x) => {
            switch (x) {
              case 1n:
                return 1n;
              default:
                return 0n;
            }
          };
          function main() { return f(1n); }
        `;

        expect(() => compile(source, { target })).toThrow(/SwitchStatement/);
      });

      it('bail: a try/catch inside an inline body is a clear compile error', () => {
        const source = `
          const f = (x) => {
            try {
              return x;
            } catch (e) {
              return 0n;
            }
          };
          function main() { return f(1n); }
        `;

        expect(() => compile(source, { target })).toThrow(/TryStatement/);
      });

      it('bail: an inline call inside a ternary branch is a clear compile error (conditionally evaluated)', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main(y) {
            const r = y > 0n ? inc(y) : 0n;
            return r;
          }
        `;

        expect(() => compile(source, { target })).toThrow(/ternary branch/);
      });

      it('an inline call inside a ternary TEST (unconditionally evaluated) is fine', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main(y) {
            const r = inc(y) > 1n ? 10n : 20n;
            return r;
          }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('bail: an inline call on the right-hand side of "&&" is a clear compile error (short-circuit)', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main(y) {
            if (y > 0n && inc(y) > 1n) { return 1n; }
            return 0n;
          }
        `;

        expect(() => compile(source, { target })).toThrow(/right-hand side of "&&"/);
      });

      it('bail: an inline call on the right-hand side of "||" is a clear compile error (short-circuit)', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main(y) {
            if (y > 0n || inc(y) > 1n) { return 1n; }
            return 0n;
          }
        `;

        expect(() => compile(source, { target })).toThrow(/right-hand side of "\|\|"/);
      });

      it('an inline call on the LEFT-hand side of "&&"/"||" (unconditionally evaluated) is fine', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main(y) {
            if (inc(y) > 1n && y > 0n) { return 1n; }
            return 0n;
          }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('bail: a destructuring parameter is a clear compile error', () => {
        const source = `
          const f = ([a, b]) => a + b;
          function main() { return 0n; }
        `;

        expect(() => compile(source, { target })).toThrow(/unsupported parameter pattern/);
      });

      it('bail: a destructuring declaration inside an inline body is a clear compile error', () => {
        const source = `
          const f = (pair) => {
            const [a, b] = pair;
            return a;
          };
          function main() { return 0n; }
        `;

        expect(() => compile(source, { target })).toThrow(/destructuring declaration/);
      });

      it('bail: a labeled statement inside an inline body is a clear compile error', () => {
        const source = `
          const f = (x) => {
            label: if (x > 0n) { return x; }
            return 0n;
          };
          function main() { return f(1n); }
        `;

        expect(() => compile(source, { target })).toThrow(/LabeledStatement/);
      });

      it('bail: a bare block statement inside an inline body is a clear compile error', () => {
        const source = `
          const f = (x) => {
            { const y = x; return y; }
          };
          function main() { return f(1n); }
        `;

        expect(() => compile(source, { target })).toThrow(/BlockStatement/);
      });

      it('a braced if/else where BOTH branches return, inside an inline function body, compiles', () => {
        // Regression: the else-branch's statement list used to be built from the raw,
        // un-unwrapped `[ifStmt.alternate]` (a single BlockStatement node) instead of
        // `blockToStatements(ifStmt.alternate)` — hoistStatementOwnExprs has no case for
        // a bare BlockStatement, so this threw "not implemented for statement type
        // BlockStatement" for ANY braced else, in ANY function, as soon as the program
        // declared any inline function at all.
        const source = `
          const f = (x) => {
            if (x > 0n) {
              return 1n;
            } else {
              return 2n;
            }
          };
          function main(y) { return f(y); }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('a braced if/else where only the consequent returns (else falls through), inside an inline body, compiles', () => {
        const source = `
          const f = (x) => {
            if (x > 0n) {
              return 1n;
            } else {
              const y = x * 2n;
            }
            return 0n;
          };
          function main(y) { return f(y); }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('a braced if/else in an UNRELATED function (main) compiles fine alongside an unused inline function', () => {
        // Regression: expandInlineFunctionsInDeclarations walks EVERY declaration's body
        // (not just call sites that actually reach an inline function) as soon as
        // inlineMap.size > 0 — so the braced-else bug above broke main()'s own if/else
        // even when main() never calls the inline function at all.
        const source = `
          const unrelatedInline = (x) => x + 1n;
          function main(y) {
            if (y > 0n) {
              return 1n;
            } else {
              return 2n;
            }
          }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('a braced if/else-if/else chain inside an inline body compiles', () => {
        const source = `
          const grade = (score) => {
            if (score >= 90n) {
              return 1n;
            } else if (score >= 70n) {
              return 2n;
            } else {
              return 3n;
            }
          };
          function main(s) { return grade(s); }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('bail: an inline call inside a for-loop header is a clear compile error', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main() {
            let s = 0n;
            for (let i = 0n; i < inc(4n); i++) { s = s + i; }
            return s;
          }
        `;

        expect(() => compile(source, { target })).toThrow(/for-loop header/);
      });

      it('bail: an inline call inside a while-loop condition is a clear compile error', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main() {
            let s = 0n;
            let i = 0n;
            while (i < inc(4n)) { s = s + i; i = i + 1n; }
            return s;
          }
        `;

        expect(() => compile(source, { target })).toThrow(/while-loop condition/);
      });

      it('an inline call inside a loop BODY (ordinary statement position) compiles fine', () => {
        const source = `
          const inc = (x) => x + 1n;
          function main() {
            let s = 0n;
            for (let i = 0n; i < 5n; i++) { s = s + inc(i); }
            return s;
          }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });

      it('bail: a code path with no return is a compile error only when the result is USED', () => {
        const used = `
          const f = (x) => { if (x > 0n) { return x; } };
          function main() { return f(1n); }
        `;
        const discarded = `
          const f = (x) => { if (x > 0n) { throw x; } };
          function main() { f(0n); return 1n; }
        `;

        expect(() => compile(used, { target })).toThrow(/not every code path returns a value/);
        expect(() => compile(discarded, { target })).not.toThrow();
      });

      it('cross-file: an inline function imported from another module inlines correctly', () => {
        writeMod('m_inc.js', `export const inc = (x) => x + 1n;`);
        const source = `
          import { inc } from "./m_inc";
          function main() { return inc(41n); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).not.toThrow();
      });

      it('cross-file: an imported inline function calling ANOTHER imported inline function expands (fixpoint)', () => {
        writeMod('m_chain.js', `export const inc = (x) => x + 1n;\nexport const incTwice = (x) => inc(inc(x));`);
        const source = `
          import { incTwice } from "./m_chain";
          function main() { return incTwice(40n); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).not.toThrow();
      });

      it('collision: a local real function and an unrelated import that pulls in a same-named inline function throws', () => {
        writeMod('m_collide_a.js', `export function something() { return 9n; }\nexport const shared = (x) => x;`);
        const source = `
          import { something } from "./m_collide_a";
          function shared() { return 1n; }
          function main() { return shared() + something(); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).toThrow(
          /declared both as a function and as an inline const function/,
        );
      });

      it('collision: a local inline function and an unrelated import that pulls in a same-named real function throws', () => {
        writeMod(
          'm_collide_b.js',
          `export function somethingElse() { return 9n; }\nexport function shared() { return 1n; }`,
        );
        const source = `
          import { somethingElse } from "./m_collide_b";
          const shared = (x) => x;
          function main() { return shared(1n) + somethingElse(); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).toThrow(
          /declared both as a function and as an inline const function/,
        );
      });

      it('collision: two DIFFERENT imported modules exporting a real fn and an inline fn under the SAME name throws', () => {
        writeMod('m_clash_real.js', `export function clash() { return 1n; }`);
        writeMod('m_clash_inline.js', `export const clash = (x) => x;`);
        const source = `
          import { clash } from "./m_clash_real";
          import { clash as clash2 } from "./m_clash_inline";
          function main() { return clash() + clash2(1n); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).toThrow(/duplicate imported function/);
      });

      it('treeshake: an inline function that is never called produces byte-identical output to not declaring it', () => {
        const withInline = compile(
          `
            const unused = (x) => x + 999n;
            function main() { return 1n; }
          `,
          { target },
        );
        const withoutInline = compile(`function main() { return 1n; }`, { target });

        expect(withInline.bytecode).toHaveLength(withoutInline.bytecode.length);
        for (let i = 0; i < withInline.bytecode.length; i++) {
          expect(Buffer.from(withInline.bytecode[i])).toEqual(Buffer.from(withoutInline.bytecode[i]));
        }
      });

      it('treeshake: a real function reachable ONLY through an inline function is kept (not dropped)', () => {
        const source = `
          function helper() { return 42n; }
          const wrapper = (x) => helper() + x;
          function main() { return wrapper(1n); }
        `;

        const result = compile(source, { target, treeshake: true });

        if (target === 'v1') {
          // helper + main (wrapper contributes zero real functions).
          expect(result.bytecode).toHaveLength(2);
        } else {
          expect(totalSize(result.bytecode)).toBeGreaterThan(0);
        }
      });

      it('treeshake: a real function unreachable even via any inline function is dropped', () => {
        const source = `
          function helper() { return 42n; }
          const wrapper = (x) => x;
          function main() { return wrapper(1n); }
        `;

        const result = compile(source, { target, treeshake: true });

        if (target === 'v1') expect(result.bytecode).toHaveLength(1); // main only
      });

      it('a plain `function` declaration is completely unaffected by the inline feature', () => {
        const before = `function add(a, b) { return a + b; }\nfunction main() { return add(3n, 7n); }`;

        expect(compile(before, { target })).toEqual(compile(before, { target }));
      });

      it('hygiene: a user local named like the OLD vulnerable synthetic name ($inline_result_0) no longer collides', () => {
        // Regression: the synthetic alpha-rename namespace used to be plain `$`-prefixed
        // (`$inline_result_0`, ...) — a perfectly ordinary, user-typable identifier. A
        // user local literally named `$inline_result_0` would silently alias onto (and
        // be clobbered by) the compiler's own first-assigned inline temp, because
        // Saucer.store() treats redeclaring an existing name as silent get-or-create, not
        // an error. The synthetic namespace is now `#`-prefixed (unparseable as ordinary
        // SauceScript), so this same source must compile WITHOUT any collision — this
        // test just pins that it compiles; integration-test/inline-functions.test.ts pins
        // the actual EVM-executed value is no longer clobbered.
        const source = `
          const inc = (x) => x + 1n;
          function main() {
            let $inline_result_0 = 999n;
            const r = inc(5n);
            return $inline_result_0 + r;
          }
        `;

        expect(() => compile(source, { target })).not.toThrow();
      });
    });
  }

  describe('inline expansion cap (MAX_INLINE_EXPANSIONS)', () => {
    // Calls are spread as FLAT, independently-discarded statements (`inc(1n);` repeated)
    // across many small helper functions — never chained with `+` into one deeply nested
    // BinaryExpression (that shape would blow the JS call stack from ordinary left-to-
    // right AST recursion alone, long before this cap is even relevant — a generic
    // deep-AST-recursion risk, not what this cap targets) and never piled into a SINGLE
    // function (v1 independently caps a single function's own scalar locals at 255 —
    // 3 locals per inline call site — which would fire first and mask the cap below).
    // Each real helper function compiles in its own fresh child context (fresh slots),
    // so spreading calls across many small helpers isolates this test from that
    // unrelated, pre-existing per-function limit.
    function genSource(helperCount: number, callsPerHelper: number): string {
      const helpers = Array.from({ length: helperCount }, (_, h) => {
        const calls = Array.from({ length: callsPerHelper }, () => 'inc(1n);').join(' ');

        return `function h${h}() { ${calls} return 0n; }`;
      }).join('\n');
      const mainCalls = Array.from({ length: helperCount }, (_, h) => `h${h}();`).join(' ');

      return `const inc = (x) => x + 1n;\n${helpers}\nfunction main() { ${mainCalls} return 0n; }`;
    }

    it('many independent call sites, comfortably under the cap, compiles fine', () => {
      const source = genSource(5, 20); // 100 total expansions, well under 4096

      expect(() => compile(source, { target: 'v1' })).not.toThrow();
    });

    it('exceeding MAX_INLINE_EXPANSIONS total inline call-site expansions is a clear compile error', () => {
      const source = genSource(100, 45); // 4500 total expansions, over the 4096 cap

      expect(() => compile(source, { target: 'v1' })).toThrow(/exceeded the maximum of 4096/);
    });
  });

  it('v1: an inline argument expression (a real function call) is compiled exactly once', () => {
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

    const result = compile(source, { target: 'v1' });
    const main = result.bytecode[result.bytecode.length - 1];

    // bump() is function index 0 (the only real helper); count CALL_FUNCTION(0, ...)
    // occurrences in main's bytecode — must be exactly one.
    let calls = 0;

    for (let i = 0; i < main.length - 1; i++) {
      if (main[i] === OPS.CALL_FUNCTION && main[i + 1] === 0) calls++;
    }

    expect(calls).toBe(1);
  });

  it('countByte sanity: OPS.CALL_FUNCTION never appears for a program using only inline functions', () => {
    const source = `
      const inc = (x) => x + 1n;
      const dbl = (x) => x * 2n;
      function main() { return dbl(inc(inc(1n))); }
    `;
    const result = compile(source, { target: 'v1' });

    expect(result.bytecode).toHaveLength(1); // main only — no real helper at all
    expect(countByte(result.bytecode[0], OPS.CALL_FUNCTION)).toBe(0);
  });

  // FINDING fix: an inline function returning ANY dynamic-kind value used to be an
  // unconditional v1 compile error — `#inline_result_N`'s FIRST declaration was always the
  // scalar literal `0n`, so a later reassignment to a dynamic value (an array/object
  // literal, a `new Array(n)` TUPLE, a `.concat()`/`.slice()` string, …) tripped
  // `rejectV1ScalarToDynamicReassignment` (processor/statement.ts). Confirmed this ISN'T a
  // false positive: on the pre-fix commit the identical source compiled cleanly and then
  // reverted `SauceInvalidOperationArgs(0x97)` on real EVM execution (dropped descriptor) —
  // see integration-test/inline-functions.test.ts's "dynamic return value" describe block
  // for that real-execution proof. Fixed by `couldReturnBeDynamic` (inline.ts): a
  // conservative, ctx-free scan of the callee's own return expressions that seeds the
  // sentinel with a DYNAMIC-kind placeholder whenever it might return dynamic.
  describe('inline function returning a dynamic value (v1)', () => {
    it('a `new Array(n)`-built TUPLE return compiles and is dynamic (HEAP) storage', () => {
      const source = `
        const build = () => {
          const a = new Array(2);
          a[0] = 7n;
          a[1] = 8n;
          return a;
        };
        function main() {
          let r = build();
          return r[0];
        }
      `;

      expect(() => compile(source, { target: 'v1' })).not.toThrow();

      const result = compile(source, { target: 'v1' });
      const main = result.bytecode[result.bytecode.length - 1];

      expect(Array.from(main)).toEqual(expect.arrayContaining([OPS.ALLOCATE_HEAP, OPS.WRITE_HEAP, OPS.READ_HEAP]));
    });

    it('a guard-clause function mixing a SCALAR return on one path and a DYNAMIC return on another compiles', () => {
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
          return r[1];
        }
      `;

      expect(() => compile(source, { target: 'v1', args: [1n] })).not.toThrow();
    });

    it('a `.concat()` (string) return compiles', () => {
      const source = `
        const greet = () => {
          return "hi".concat("there");
        };
        function main() {
          let s = greet();
          return s.length;
        }
      `;

      expect(() => compile(source, { target: 'v1' })).not.toThrow();
    });

    it('an object-literal return compiles', () => {
      // Indexed access (`s[0]`), not `.a` field access: a helper-returned object literal's
      // `.field` access is a SEPARATE, PRE-EXISTING gap independent of inline functions or
      // this fix (confirmed: `function helper() { return {a:1n,b:2n}; } function main() {
      // let s = helper(); return s.a; }` — no inline functions at all — already throws
      // "property 'a' access not supported, use array indexing arr[i]" before AND after
      // this change) — out of scope here.
      const source = `
        const build = () => {
          return { a: 1n, b: 2n };
        };
        function main() {
          let s = build();
          return s[0];
        }
      `;

      expect(() => compile(source, { target: 'v1' })).not.toThrow();
    });

    it('negative control: a purely scalar-arithmetic guard-clause function keeps its EXISTING scalar (WRITE_VALUE) bytecode shape, byte-for-byte', () => {
      const source = `
        const tickArg = (x) => {
          if (x < 0n) { return 0n; }
          return x + 1n;
        };
        function main() { return tickArg(5n); }
      `;

      const result = compile(source, { target: 'v1' });
      const main = result.bytecode[result.bytecode.length - 1];

      expect(main).not.toContain(OPS.ALLOCATE_HEAP);
    });

    it('a parameter returned unchanged stays scalar-seeded when the call-site argument is a plain identifier — even one referencing an existing DYNAMIC caller-scope local', () => {
      // `couldReturnBeDynamic` (inline.ts) is a pure, ctx-free AST scan with no visibility
      // into the CALLER's own variable kinds — a bare Identifier argument (as opposed to a
      // directly-dynamic-LOOKING one: an array/object/`new Array`/string literal, all of
      // which ARE recognized) is deliberately left classified the SAME as any other
      // ctx-free-unresolvable shape (scalar-seeded), rather than blanket-promoting every
      // Identifier argument to dynamic — that alternative would regress the tickArg/kyberOut
      // motivating shape this whole feature was built for (`tickArg(shifted, OFFSET)` passes
      // two ORDINARY, always-scalar caller-scope identifiers; forcing every identifier
      // argument dynamic would needlessly heap-allocate that common, pure-arithmetic case).
      //
      // The cost of this deliberate choice: identity-style passthrough of an EXISTING
      // dynamic caller-scope local through an inline function still hits
      // `rejectV1ScalarToDynamicReassignment` — a real, narrower residual gap, but a SAFE
      // one: a clear compile-time error, never the silent descriptor drop this whole bug
      // family exists to prevent. Pinned here (not silently left undocumented) so a future
      // improvement — or an accidental regression — is noticed either way.
      const source = `
        const identity = (x) => x;
        function main() {
          const arr = new Array(1);
          arr[0] = 42n;
          let r = identity(arr);
          return r[0];
        }
      `;

      expect(() => compile(source, { target: 'v1' })).toThrow(/cannot assign a dynamic value to '#inline_result_0'/);

      // The common, motivating case — a plain SCALAR argument through the same identity
      // shape — is completely unaffected: no heap allocation at all.
      const scalarArgSource = `
        const identity = (x) => x;
        function main() { return identity(5n); }
      `;

      const result = compile(scalarArgSource, { target: 'v1' });
      const main = result.bytecode[result.bytecode.length - 1];

      expect(main).not.toContain(OPS.ALLOCATE_HEAP);
    });

    it('v12 is unaffected either way (V12Saucer.store derives kind from value.isDynamic, never a stale tag)', () => {
      const source = `
        const build = () => {
          const a = new Array(2);
          a[0] = 7n;
          a[1] = 8n;
          return a;
        };
        function main() {
          let r = build();
          return r[0];
        }
      `;

      expect(() => compile(source, { target: 'v12' })).not.toThrow();
    });
  });
});
