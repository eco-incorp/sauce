import { cook, deploy } from './utils.js';
import { execSync } from 'child_process';
import { resolve } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const RPC = 'http://127.0.0.1:8546';

/**
 * Real-EVM proof for a full sweep of the "dynamic-value storage kind" bug family (see
 * CLAUDE.md's "Same-file user-function return-kind inference" note for the three
 * already-fixed instances this sweep continues investigating): every shape the sweep
 * checked, on v1, with a clear reproduced/not-reproduced verdict backed by real `cook()`
 * execution — not just reasoning about the codegen. v12/svm-side proofs for the same
 * shapes live in `v12-execution.test.ts` / `svm-execution.test.ts`.
 */
describe('integration: dynamic-value storage-kind sweep (v1)', () => {
  // ── sweep finding: single, non-destructured dynamic ABI output (FIXED) ──
  //
  // `let xs = List.at(addr).list2();` where `list2()` returns a SINGLE `uint256[]` (not a
  // multi-output tuple, so the pre-existing `multiOutputCall` tag mechanism never applied)
  // used to under-classify `xs` as 'scalar' — the identical descriptor-drop hazard as the
  // three already-fixed instances, one shape further out. Fixed by
  // `singleDynamicAbiOutputKind` (processor/statement.ts) for the direct store path and a
  // matching case in `kindOfExpr` (processor/return-kind.ts) so a HELPER that stores and
  // returns such a call is classified correctly too.
  describe('single dynamic ABI output stored in a variable', () => {
    const LIST2_ADDR = '0x0000000000000000000000000000000000007006';
    // Single-output (uint256[] only) mock runtime: offset(0x20), length(2), 11, 22.
    const LIST2_CODE = '0x60205f526002602052600b604052601660605260805ff3';

    const abi = [
      {
        type: 'function',
        name: 'list2',
        inputs: [],
        outputs: [{ name: 'xs', type: 'uint256[]' }],
        stateMutability: 'view',
      },
    ];

    let tmpDir: string;

    beforeAll(() => {
      execSync(`cast rpc anvil_setCode ${LIST2_ADDR} ${LIST2_CODE} --rpc-url ${RPC}`, { encoding: 'utf8' });
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-single-dynamic-output-'));
      fs.writeFileSync(path.join(tmpDir, 'List2.json'), JSON.stringify({ abi }));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const IMPORT = 'import { List2 } from "./List2.json";';
    const ADDR = `${BigInt(LIST2_ADDR)}n`;

    it('direct indexed read round-trips (was a silent scalar-kind revert)', () => {
      const source = `${IMPORT}
        function main() { let xs = List2.at(${ADDR}).list2(); return xs[1]; }`;

      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(22n);
    });

    it('.length resolves correctly (was reading the scalar word-width fallback instead)', () => {
      const source = `${IMPORT}
        function main() { let xs = List2.at(${ADDR}).list2(); return xs.length; }`;

      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(2n);
    });

    it('aliasing composes correctly with the aliasing fix already in place', () => {
      const source = `${IMPORT}
        function main() { let xs = List2.at(${ADDR}).list2(); let ys = xs; return ys[1]; }`;

      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(22n);
    });

    it('a HELPER that stores and returns the call is classified correctly too (return-kind.ts)', () => {
      const source = `${IMPORT}
        function helper() { let xs = List2.at(${ADDR}).list2(); return xs; }
        function main() { let arr = helper(); return arr[1]; }`;

      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(22n);
    });

    it('a second, unrelated call in between does not disturb the first result', () => {
      const source = `${IMPORT}
        function main() {
          let xs = List2.at(${ADDR}).list2();
          let ys = List2.at(${ADDR}).list2();
          return xs[1] + ys[0] * 100n;
        }`;

      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(22n + 11n * 100n);
    });

    it('an intervening .catch()-wrapped call does not disturb an earlier stored result', () => {
      const source = `${IMPORT}
        function main() {
          let xs = List2.at(${ADDR}).list2();
          List2.at(${ADDR}).list2().catch(() => {});
          return xs[1];
        }`;

      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(22n);
    });

    // ADVERSARIAL-AUDIT FINDING (this branch): `processTernaryStore`'s `branchKind`
    // computation (statement.ts) never consulted `singleDynamicAbiOutputKind` for a
    // ternary branch that is itself a direct dynamic-output contract call — only
    // `inferKindWithContext`, which has no notion of a direct contract call at all. See
    // test/destructuring.test.ts's "ternary branchKind" describe block for the
    // compile-time-shape proof; this is the real-EVM-execution proof of the same fix.
    it('a ternary whose taken branch is a direct dynamic-output contract call round-trips correctly (was a silent scalar-kind revert)', () => {
      const source = `${IMPORT}
        function main(cond) {
          let xs = cond === 1n ? List2.at(${ADDR}).list2() : 0n;
          return xs[0] + xs[1] * 100n;
        }`;

      // Before the fix: `branchKind` computed 'scalar' for this ternary (neither branch
      // is dynamic per `inferKindWithContext` alone), so `xs` stored via WRITE_VALUE —
      // dropping List2.list2()'s decoded array descriptor: SauceInvalidOperationArgs(0x97)
      // on `xs[0]` when the dynamic branch (cond === 1n) is taken.
      expect(BigInt(cook(source, { baseDirs: [tmpDir], args: [1n] }))).toBe(11n + 22n * 100n);
    });

    // FINDING fix: the same single-dynamic-output classification, reached through a
    // VARIABLE-BOUND contract call (`let pool = X.at(addr); pool.method();`) instead of the
    // inline `X.at(addr).method()` chain. `kindOfExpr`'s (return-kind.ts) fixpoint pre-pass
    // runs against the bare module-level ctx, which never has `ctx.boundContracts`
    // populated (that only happens on a per-function CHILD context while actually
    // compiling a body) — so `resolveContractCallTarget` alone could never resolve this
    // shape here, and `helper`'s return kind silently fell back to 'scalar', dropping the
    // descriptor exactly like the original bug. Fixed by tracking the `let pool =
    // List2.at(addr);` binding into this pass's own pass-local map.
    it('a HELPER using a VARIABLE-BOUND contract call is classified correctly too (return-kind.ts localBoundContracts)', () => {
      const source = `${IMPORT}
        function helper() {
          let pool = List2.at(${ADDR});
          return pool.list2();
        }
        function main() { let arr = helper(); return arr[1]; }`;

      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(22n);
    });
  });

  // ── ADVERSARIAL-AUDIT FINDING (this branch): a REASSIGNED bound-contract variable
  // went stale in return-kind.ts's own `localBoundContracts` pass-local bookkeeping ──
  //
  // `walkStatement`'s `VariableDeclaration` case tracks `let pool = Contract.at(addr);`
  // into `localBoundContracts` so a LATER `pool.method()` call resolves during this
  // fixpoint pre-pass — but the sibling `AssignmentExpression` case never updated that
  // map when `pool` was later REASSIGNED to a DIFFERENT bound contract
  // (`pool = Contract2.at(addr2);`), so the stale FIRST binding stayed there forever —
  // even though the REAL compile stage's own `ctx.boundContracts` updates correctly on
  // this exact reassignment (via `consumePendingContractBinding`, which fires for every
  // store whose RHS was a standalone binding call). See test/return-kind.test.ts's "a
  // reassigned variable-bound contract" describe block for the compile-time-shape proof
  // of BOTH confirmed failure modes (a false-positive "Unknown method" compile crash,
  // and this silent under-classification); this is the real-EVM-execution proof of the
  // silent one — the crash mode has no runtime VALUE to prove, it either aborts the
  // compile or it doesn't.
  describe('a reassigned variable-bound contract resolves against the LATEST binding, not a stale one (real EVM)', () => {
    const SCALAR_ADDR = '0x0000000000000000000000000000000000007008';
    const SCALAR_CODE = '0x602a60005260206000f3'; // returns a single uint256: 42
    const DYNAMIC_ADDR = '0x0000000000000000000000000000000000007009';
    // Same single-output (uint256[] only) mock runtime as List2 above: offset(0x20), length(2), 11, 22.
    const DYNAMIC_CODE = '0x60205f526002602052600b604052601660605260805ff3';

    const contracts = {
      ScalarSrc: {
        abi: [
          {
            type: 'function',
            name: 'data',
            inputs: [],
            outputs: [{ name: 'v', type: 'uint256' }], // scalar
            stateMutability: 'view',
          },
        ] as const,
      },
      DynamicSrc: {
        abi: [
          {
            type: 'function',
            name: 'data',
            inputs: [],
            outputs: [{ name: 'xs', type: 'uint256[]' }], // dynamic — SAME method name as ScalarSrc
            stateMutability: 'view',
          },
        ] as const,
      },
    };

    beforeAll(() => {
      execSync(`cast rpc anvil_setCode ${SCALAR_ADDR} ${SCALAR_CODE} --rpc-url ${RPC}`, { encoding: 'utf8' });
      execSync(`cast rpc anvil_setCode ${DYNAMIC_ADDR} ${DYNAMIC_CODE} --rpc-url ${RPC}`, { encoding: 'utf8' });
    });

    it('a helper reassigning pool from a SCALAR-output contract to a DYNAMIC-output contract sharing the same method name round-trips correctly (was a silent scalar-kind revert)', () => {
      const source = `
        function helper() {
          let pool = ScalarSrc.at(${BigInt(SCALAR_ADDR)}n);
          pool = DynamicSrc.at(${BigInt(DYNAMIC_ADDR)}n);
          return pool.data();
        }
        function main() {
          let arr = helper();
          return arr[0] + arr[1] * 100n;
        }
      `;

      // DynamicSrc.data() = [11, 22] → 11 + 22*100 = 2211. Before the fix, return-kind.ts's
      // stale `localBoundContracts` entry (still pointing at ScalarSrc, never updated by the
      // reassignment) classified `helper`'s return kind as 'scalar' — even though the REAL
      // compiled call correctly targets DynamicSrc (`ctx.boundContracts`, the ACTUAL
      // compile-time binding map used to emit the call itself, updates correctly on this
      // reassignment) — so `main()`'s `let arr = helper();` stored the decoded array via
      // WRITE_VALUE, dropping the descriptor: SauceInvalidOperationArgs(0x97) on `arr[0]`.
      expect(BigInt(cook(source, { contracts: contracts as never }))).toBe(2211n);
    });
  });

  // ── sweep finding: ternary with a dynamic branch, FIRST declaration (FIXED) ──
  //
  // `let x = cond ? arr : other;` used to always store `x` as scalar regardless of the
  // branches (`processTernaryStore` never consulted a kind at all before this fix),
  // dropping the descriptor of whichever branch is taken. Fixed by promoting to 'dynamic'
  // storage when EITHER branch resolves dynamic — the sound "promote, never demote"
  // direction this whole bug family already uses (see `processTernaryStore`'s own doc
  // comment). A REASSIGNMENT of an already-scalar variable is a DIFFERENT, unfixable case
  // (v1 can't re-class a slot) — see `test/dynamic-reassignment-guard.test.ts` for that
  // compile-time-rejection half of this same finding.
  describe('ternary with a dynamic branch — first declaration now round-trips', () => {
    const source = `
      function main(cond) {
        const arr = new Array(2);
        arr[0] = 7n;
        arr[1] = 8n;
        const other = new Array(2);
        other[0] = 100n;
        other[1] = 200n;
        let x = cond === 1n ? arr : other;
        return x[0] + x[1];
      }
    `;

    it('the dynamic branch (cond truthy) round-trips', () => {
      expect(BigInt(cook(source, { args: [1n] }))).toBe(15n); // 7 + 8
    });

    it('the other dynamic branch (cond falsy) round-trips too', () => {
      expect(BigInt(cook(source, { args: [0n] }))).toBe(300n); // 100 + 200
    });

    it('an if/else-assigned pair (both sides first-declared dynamic) round-trips identically', () => {
      // SauceScript shares scope across if/else (no per-branch block scope), so a name
      // FIRST declared in one branch and again in the other resolves to the SAME
      // variable/slot — both branches here declare `x` as dynamic, so this is the
      // if/else analogue of the ternary case above, not a reassignment.
      const ifElseSource = `
        function main(cond) {
          const arr = new Array(2);
          arr[0] = 7n;
          arr[1] = 8n;
          const other = new Array(2);
          other[0] = 100n;
          other[1] = 200n;
          if (cond === 1n) {
            let x = arr;
            return x[0] + x[1];
          } else {
            let x = other;
            return x[0] + x[1];
          }
        }
      `;

      expect(BigInt(cook(ifElseSource, { args: [1n] }))).toBe(15n);
      expect(BigInt(cook(ifElseSource, { args: [0n] }))).toBe(300n);
    });
  });

  // ── sweep finding: && / || are NOT a kind bug (NOT reproduced — documented, not fixed) ──
  //
  // SauceScript's && / || are BOOLEAN operators (BOOL_AND/BOOL_OR), not JS-style
  // value-returning short-circuits — `cond && arr` yields a boolean, engine-consistently,
  // so indexing it is a meaningless program, not a dropped descriptor. Locked here via
  // real execution so this is never re-investigated as a kind-inference gap.
  it('&&/|| yield a boolean, not one of their operands (not a kind bug)', () => {
    const source = 'function main() { let c = 1n; let x = c && 3n; return x; }';

    expect(BigInt(cook(source))).toBe(1n); // NOT 3n — BOOL_AND, not JS-style &&
  });

  // ── sweep finding: recursive same-file function returning a dynamic value (NOT
  // reproduced — the fixpoint converges through both self- and mutual recursion, and the
  // runtime descriptor round-trips correctly across a recursive RETURN). v12/svm versions
  // of the identical shapes live in v12-execution.test.ts/svm-execution.test.ts.
  describe('recursion + dynamic RETURN (regression lock)', () => {
    it('self-recursion: the fixpoint promotes through a cycle and the value round-trips', () => {
      const source = `
        function build(n) {
          if (n === 0n) {
            let a = new Array(3);
            a[0] = 5n;
            return a;
          }
          let inner = build(n - 1n);
          return inner;
        }
        function main() {
          let r = build(2n);
          return r[0];
        }
      `;

      expect(BigInt(cook(source))).toBe(5n);
    });

    it('mutual recursion: same guarantee across a two-function cycle', () => {
      const source = `
        function isEven(n) {
          if (n === 0n) {
            let a = new Array(1);
            a[0] = 5n;
            return a;
          }
          return isOdd(n - 1n);
        }
        function isOdd(n) {
          if (n === 0n) {
            let a = new Array(1);
            a[0] = 9n;
            return a;
          }
          return isEven(n - 1n);
        }
        function main() {
          let r = isEven(4n);
          return r[0];
        }
      `;

      expect(BigInt(cook(source))).toBe(5n);
    });
  });

  // ── sweep finding: recursive call passing a dynamic ARGUMENT (v1 KNOWN GAP,
  // unfixed — covered by the same call-argument gap as the non-recursive case in
  // function-return-kind.test.ts). Locked here so a future v1 fix for the base
  // call-argument gap is checked against the recursive shape too.
  it('KNOWN GAP (unfixed, v1-only): a dynamic argument round-tripping through a recursive call still reverts', () => {
    const source = `
      function walk(a, n) {
        if (n === 0n) { return a[1]; }
        return walk(a, n - 1n);
      }
      function main() {
        const arr = new Array(2);
        arr[0] = 1n;
        arr[1] = 4n;
        return walk(arr, 3n);
      }
    `;

    expect(() => cook(source)).toThrow();
  });

  // ── sweep finding: two-hop dynamic argument (store into a SECOND local inside the
  // callee before use) — v1 KNOWN GAP, unfixed; composes with (but is not caused by) the
  // aliasing fix already in place. v12/svm pass these (see the `callarg_*` vectors in
  // v12-execution.test.ts/svm-execution.test.ts).
  describe('KNOWN GAP (unfixed, v1-only): two-hop dynamic call argument', () => {
    it('store-then-use', () => {
      const source = `
        function h(a) { let b = a; return b[1]; }
        function main() {
          const arr = new Array(3);
          arr[0] = 1n; arr[1] = 2n; arr[2] = 3n;
          return h(arr);
        }
      `;

      expect(() => cook(source)).toThrow();
    });

    it('store-then-mutate', () => {
      const source = `
        function h(a) { let b = a; b[0] = 9n; return b[0] + b[1] * 10n; }
        function main() {
          const arr = new Array(3);
          arr[0] = 1n; arr[1] = 2n; arr[2] = 3n;
          return h(arr);
        }
      `;

      expect(() => cook(source)).toThrow();
    });

    it('two alias hops', () => {
      const source = `
        function h(a) { let b = a; let c = b; return c[1]; }
        function main() {
          const arr = new Array(3);
          arr[0] = 1n; arr[1] = 2n; arr[2] = 3n;
          return h(arr);
        }
      `;

      expect(() => cook(source)).toThrow();
    });
  });

  // ── sweep finding: a dynamic value crossing a .catch(handler) chain (NOT reproduced —
  // no catch-specific gap; resolveCatchChain compiles the handler against the SAME
  // CompilerContext as its surrounding code, so a handler mutating an enclosing dynamic
  // local, or a dynamic local read after an intervening catch chain, both work correctly).
  describe('.catch() composition with a dynamic local (regression lock)', () => {
    let addr: bigint;
    const baseDirs = [resolve(process.cwd(), 'node_modules/sauce/engine/out/MockTarget.sol')];

    beforeAll(() => {
      addr = BigInt(deploy('test/mocks/MockTarget.sol:MockTarget'));
    });

    it('a catch handler mutating an enclosing dynamic local round-trips after the chain', () => {
      const source = `
        import { MockTarget } from "./MockTarget.json";
        function main() {
          const a = new Array(2);
          MockTarget.at(${addr}n).revertWithMessage().catch(() => {
            a[0] = 7n;
          });
          return a[0];
        }
      `;

      expect(BigInt(cook(source, { baseDirs }))).toBe(7n);
    });

    it('a dynamic local declared BEFORE the chain reads correctly AFTER an unrelated catch', () => {
      const source = `
        import { MockTarget } from "./MockTarget.json";
        function main() {
          const a = new Array(2);
          a[0] = 7n;
          MockTarget.at(${addr}n).revertWithMessage().catch(() => {});
          return a[0];
        }
      `;

      expect(BigInt(cook(source, { baseDirs }))).toBe(7n);
    });
  });

  // ── sweep finding: compound assignment / update expressions involving dynamic values ──
  describe('compound assignment on a dynamic value (regression lock)', () => {
    it('local compound assignment (arr[0] += 10n) round-trips cleanly', () => {
      const source = `
        function main() {
          const arr = new Array(1);
          arr[0] = 2n;
          arr[0] += 10n;
          return arr[0];
        }
      `;

      expect(BigInt(cook(source))).toBe(12n);
    });

    it('compound assignment through an alias lands on the shared backing array', () => {
      const source = `
        function main() {
          const a = new Array(1);
          a[0] = 2n;
          let b = a;
          b[0] += 10n;
          return a[0];
        }
      `;

      expect(BigInt(cook(source))).toBe(12n);
    });

    it('`arr[0]++` is a clean compile-time rejection, not a miscompile, on every target', () => {
      const src = 'function main() { const arr = new Array(1); arr[0]++; }';

      expect(() => cook(src)).toThrow();
    });

    it('KNOWN GAP (unfixed, v1-only): compound assignment on a dynamic PARAMETER still reverts', () => {
      const source = `
        function h(a) { a[0] += 10n; return a[0]; }
        function main() {
          const arr = new Array(1);
          arr[0] = 2n;
          return h(arr);
        }
      `;

      expect(() => cook(source)).toThrow();
    });
  });

  // ── sweep finding: string/bytes dynamic values ──
  describe('string/bytes dynamic values (regression lock)', () => {
    it('.concat() result aliased through a second local resolves its length correctly', () => {
      const source = `
        function main() {
          let a = "AB";
          let b = a.concat("CD");
          let c = b;
          return c.length;
        }
      `;

      expect(BigInt(cook(source))).toBe(4n);
    });

    // The ONE call-argument-gap shape that fails SILENTLY rather than reverting — a
    // string parameter's `.length` reads the SCALAR WORD WIDTH (32) instead of the
    // string's real length, with no revert at all. Strictly worse than the array-shaped
    // KNOWN GAP cases (which at least fail loudly) — recorded here so it is never
    // mistaken for a passing case. v12/svm are unaffected (see the companion
    // `callarg_param_length` vector in v12-execution.test.ts, and the analogous string
    // vector added to svm-execution.test.ts).
    it("KNOWN GAP (unfixed, v1-only, SILENT): a string parameter's .length reads the scalar word width, not the real length", () => {
      const source = `
        function h(s) { return s.length; }
        function main() { return h("AB"); }
      `;

      // Does NOT throw — this is the silent-wrong-answer half of the gap.
      expect(BigInt(cook(source))).toBe(32n); // WRONG: "AB".length is 2, not 32
    });
  });
});
