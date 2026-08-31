import { cook } from './utils.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const RPC = 'http://127.0.0.1:8546';

/**
 * Real-EVM proof for the same-file-function RETURN-kind inference fix
 * (`compiler/src/processor/return-kind.ts` + `inference.ts`'s `inferKindWithContext`) — the
 * same failure family as the already-fixed "new Array(n)" (inference.ts's NewExpression
 * case) and "multiOutputCall" (processor/statement.ts) bugs, one call-boundary further
 * out. See CLAUDE.md's "Same-file user-function return-kind inference" note for the full
 * story. `test/return-kind.test.ts` pins the compiled bytecode SHAPE; these prove the
 * bytecode's real, executed VALUE via `cook()` against a deployed engine on anvil —
 * mirroring how `ts-frontend-array.test.ts` proves the (different, ts-frontend-only) local
 * array-folding feature end to end.
 *
 * Before this fix: `let arr = helper();` (where `helper()`'s own body returns a
 * `new Array(n)`-built TUPLE) stored `arr` via WRITE_VALUE/READ_VALUE (a bare 32-byte
 * slot), discarding the TUPLE descriptor — a later `arr[0] = x;` reverted
 * `SauceInvalidOperationArgs(0x9b)` (SET_INDEX) and a bare `arr[0]` read reverted
 * `SauceInvalidOperationArgs(0x97)` (INDEX). Plain aliasing of an existing dynamic local
 * (`let b = a;`, no function call at all) reverted identically. All of the below are
 * confirmed to have reverted this way BEFORE this fix (see this repo's CLAUDE.md and the
 * task's own diagnosis for the exact revert payloads).
 */
describe('integration: same-file function return-kind inference (dynamic/heap round-trip)', () => {
  it('the EXACT motivating case: main() assigns a helper-returned new Array(n), overwrites arr[0] with a genuinely runtime value, and returns it', () => {
    // Precisely the shape from the task's own repro — `arr[0]` is overwritten with a
    // value that cannot be compile-time-folded (`ctx.selfBalance()`), so this can only pass
    // via a real SET_INDEX/heap round-trip, never a lucky constant fold.
    const source = `
      function helper() {
        const arr = new Array(3);
        for (let i = 0n; i < 3n; i++) {
          arr[i] = i * 2n;
        }
        return arr;
      }
      function main() {
        let arr = helper();
        arr[0] = ctx.selfBalance();
        return arr[0];
      }
    `;

    const viaMutatedArray = BigInt(cook(source));
    const viaDirect = BigInt(cook('function main() { return ctx.selfBalance(); }'));

    expect(viaMutatedArray).toBe(viaDirect);
  });

  it('mutation: helper() returns a new Array(n); main() overwrites one element and combines it with another', () => {
    const source = `
      function helper() {
        const arr = new Array(3);
        arr[0] = 1n;
        arr[1] = 2n;
        arr[2] = 3n;
        return arr;
      }
      function main() {
        let arr = helper();
        arr[0] = 42n;
        return arr[0] + arr[1] * 10n;
      }
    `;

    expect(BigInt(cook(source))).toBe(62n);
  });

  it('read-only consumption: helper() returns a new Array(n); main() reads an element with NO mutation', () => {
    const source = `
      function helper() {
        const arr = new Array(3);
        arr[0] = 1n;
        arr[1] = 2n;
        arr[2] = 3n;
        return arr;
      }
      function main() {
        let arr = helper();
        return arr[1];
      }
    `;

    expect(BigInt(cook(source))).toBe(2n);
  });

  it('a bare (unindexed) round-trip: `const x = helper(); return x;` does not revert', () => {
    // NOTE: this does NOT return the clean `uint256[3]` wire encoding — that is a
    // SEPARATE, already-existing feature (the ts-frontend's `main()`-only, compile-time-
    // constant "return-escape fold", see CLAUDE.md), which never applies here (the array
    // is built inside `helper()`, a different function, not folded at all). v1's
    // `execute()` returns a TUPLE's raw `.data` verbatim, which for a `new Array(n)`
    // TUPLE is a set of per-element memory ADDRESSES, not the underlying values (see
    // CLAUDE.md's "WHY IT IS SAFE" note on the return-escape fold for the full
    // explanation) — true whether or not `x` round-trips through a variable. What THIS
    // fix changes is that this bare round-trip no longer reverts (Before the fix, `let x
    // = helper()` stored `x` in a VALUE slot, so `x`'s bytes on read-back were the
    // array's byte LENGTH, not a TUPLE descriptor at all — still non-reverting, but for
    // an entirely different, accidental reason). The interesting (and previously
    // reverting) cases are the indexed reads/writes covered by the other tests in this
    // file.
    const source = `
      function helper() {
        const arr = new Array(3);
        arr[0] = 0n;
        arr[1] = 2n;
        arr[2] = 4n;
        return arr;
      }
      function main() {
        const x = helper();
        return x;
      }
    `;

    const result = cook(source);

    expect(() => cook(source)).not.toThrow();
    // 3 elements * 32 bytes = 96 bytes = 192 hex chars + '0x'.
    expect(result).toHaveLength(194);
  });

  it('plain aliasing (NO function call at all): `let b = a; b[1] = 9n;` round-trips through the second variable', () => {
    const source = `
      function main() {
        const a = new Array(3);
        a[0] = 7n;
        let b = a;
        b[1] = 9n;
        return b[1];
      }
    `;

    expect(BigInt(cook(source))).toBe(9n);
  });

  it('forward-declaration order: the callee declared AFTER its caller executes identically to callee-first', () => {
    const source = `
      function main() {
        let arr = helper();
        arr[0] = 42n;
        return arr[0] + arr[1] * 10n;
      }
      function helper() {
        const arr = new Array(3);
        arr[0] = 1n;
        arr[1] = 2n;
        arr[2] = 3n;
        return arr;
      }
    `;

    expect(BigInt(cook(source))).toBe(62n);
  });

  it('a 3-level forward-reference chain (a→b→c, only c directly dynamic) round-trips correctly end to end', () => {
    const source = `
      function a() { return b(); }
      function b() { return c(); }
      function c() {
        const arr = new Array(2);
        arr[0] = 7n;
        arr[1] = 8n;
        return arr;
      }
      function main() {
        let z = a();
        z[0] = 5n;
        return z[0] + z[1];
      }
    `;

    expect(BigInt(cook(source))).toBe(13n); // 5 + 8
  });

  it('a mixed-return helper (one path scalar, one path dynamic) is dynamic on the taken dynamic path and round-trips correctly', () => {
    const source = `
      function helper(cond) {
        if (cond === 1n) {
          const arr = new Array(2);
          arr[0] = 10n;
          arr[1] = 20n;
          return arr;
        }
        return 5n;
      }
      function main() {
        let x = helper(1n);
        x[0] = 99n;
        return x[0] + x[1];
      }
    `;

    expect(BigInt(cook(source))).toBe(119n); // 99 + 20
  });

  // Core-acorn-stack fix (inference.ts / return-kind.ts), NOT a ts-frontend feature — must
  // reproduce identically with `tsSource: true`, since a `.ts`/`.sauce.ts` source runs
  // through the ts-frontend's OWN fold passes strictly before acorn ever sees it.
  describe('identical results compiled through the ts-frontend (tsSource: true)', () => {
    it('the mutation fixture', () => {
      const source = `
        function helper() {
          const arr = new Array(3);
          arr[0] = 1n;
          arr[1] = 2n;
          arr[2] = 3n;
          return arr;
        }
        function main() {
          let arr = helper();
          arr[0] = 42n;
          return arr[0] + arr[1] * 10n;
        }
      `;

      expect(BigInt(cook(source, { tsSource: true }))).toBe(62n);
    });

    it('the aliasing fixture', () => {
      const source = `
        function main() {
          const a = new Array(3);
          a[0] = 7n;
          let b = a;
          b[1] = 9n;
          return b[1];
        }
      `;

      expect(BigInt(cook(source, { tsSource: true }))).toBe(9n);
    });
  });

  // A FOURTH instance of the same failure family, in the RETURN direction via a
  // DESTRUCTURING declarator: `analyzeFunctionReturnKinds`'s `walkStatement` used to only
  // handle a plain `const x = expr;` (Identifier) declarator — a `const [n, xs] =
  // Contract.at(addr).method();` ArrayPattern declarator was silently skipped, so `xs` never
  // entered the pass's own `locals` map even though the REAL compiler
  // (processDestructuringDeclaration/abiOutputKind) correctly tracks `xs` as `dynamic` for a
  // `uint256[]`/`bytes`/`string` ABI output. A later `return xs;` in the same helper then
  // fell through to `locals.get('xs') ?? 'scalar'`'s default, so `helper`'s registered return
  // kind was wrongly 'scalar' and `main()`'s `let arr = helper();` stored via WRITE_VALUE
  // instead of WRITE_HEAP, dropping the TUPLE descriptor — compiled cleanly but reverted at
  // cook() on `arr[0]` (confirmed via git-stash bisection on this exact fixture:
  // `SauceInvalidOperationArgs(0x97)`, INDEX; a different repro against an undeployed
  // address instead surfaces `panic: arithmetic underflow or overflow (0x11)` — which
  // specific fault code surfaces depends on the exact garbage bit pattern the mis-stored
  // WRITE_VALUE word happens to contain, but both share the identical root cause). Fixed by
  // `applyDestructuringKinds` (return-kind.ts), which resolves the destructuring
  // declarator's own contract-call initializer (the same `resolveContractCallTarget` the
  // real compiler uses) and records each bound name's REAL per-output ABI kind, exactly like
  // the real compiler does.
  describe('a FOURTH instance: a helper that destructures a dynamic ABI output and returns it bare', () => {
    // Same etched mock fixture as integration-test/destructuring.test.ts's own LIST_ADDR/
    // LIST_CODE — a real, deployed-bytecode contract returning `(9, uint256[2] [11, 22])`
    // for any calldata. Reused verbatim (idempotent `anvil_setCode`) so the call itself
    // succeeds and the only thing under test is whether the returned array round-trips.
    const LIST_ADDR = '0x0000000000000000000000000000000000007004';
    const LIST_CODE = '0x60095f5260406020526002604052600b606052601660805260a05ff3';

    const abi = [
      {
        type: 'function',
        name: 'list',
        inputs: [],
        outputs: [
          { name: 'n', type: 'uint256' },
          { name: 'xs', type: 'uint256[]' },
        ],
        stateMutability: 'view',
      },
    ];

    let tmpDir: string;

    beforeAll(() => {
      execSync(`cast rpc anvil_setCode ${LIST_ADDR} ${LIST_CODE} --rpc-url ${RPC}`, { encoding: 'utf8' });
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-return-kind-destructure-'));
      fs.writeFileSync(path.join(tmpDir, 'Pool.json'), JSON.stringify({ abi }));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('main() indexes the helper-returned array — was a revert, now round-trips correctly', () => {
      const source = `
        import { Pool } from "./Pool.json";
        function helper() {
          const [n, xs] = Pool.at(${BigInt(LIST_ADDR)}n).list();
          return xs;
        }
        function main() {
          let arr = helper();
          return arr[0] + arr[1] * 100n;
        }
      `;

      // xs = [11, 22] → 11 + 22*100 = 2211. Before the fix this reverted
      // `SauceInvalidOperationArgs(0x97)` (INDEX) — see the describe block's own doc comment.
      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(2211n);
    });

    // `applyDestructuringKinds`'s CONSERVATIVE fallback path: a destructuring call through a
    // VARIABLE-BOUND contract (`let pool = Contract.at(addr); pool.method()`) can never be
    // resolved this early (see return-kind.ts's own doc comment — `ctx.lookupBoundContract`
    // has nothing registered yet against the bare module-level `ctx` this pre-pass runs
    // against), so EVERY bound name is conservatively promoted to 'dynamic' regardless of its
    // REAL ABI kind. Here the real output is a plain uint256 (genuinely scalar) — proving the
    // over-classification is harmless: `helper`'s registered return kind becomes 'dynamic',
    // so `main()` stores its result via WRITE_HEAP even though the ACTUAL value `helper()`
    // returns at runtime is an ordinary scalar bytes32 — exactly the same "a scalar value
    // survives a HEAP slot" property the mixed-return-helper tests above already rely on.
    it('conservative fallback: destructuring through a variable-bound contract over-classifies a SCALAR output as dynamic, and still round-trips correctly', () => {
      const SEVEN_ADDR = '0x0000000000000000000000000000000000007001';
      const SEVEN_CODE = '0x6005600052600760205260e06000f3'; // returns (5, 7, 0, 0, 0, 0, 0)

      execSync(`cast rpc anvil_setCode ${SEVEN_ADDR} ${SEVEN_CODE} --rpc-url ${RPC}`, { encoding: 'utf8' });

      const boundTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-return-kind-bound-'));
      const sevenAbi = [
        {
          type: 'function',
          name: 'vals',
          inputs: [],
          outputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name, type: 'uint256' })),
          stateMutability: 'view',
        },
      ];
      fs.writeFileSync(path.join(boundTmpDir, 'Seven.json'), JSON.stringify({ abi: sevenAbi }));

      const source = `
        import { Seven } from "./Seven.json";
        function helper() {
          let pool = Seven.at(${BigInt(SEVEN_ADDR)}n);
          const [a, b] = pool.vals();
          return b;
        }
        function main() {
          let v = helper();
          return v + 1n;
        }
      `;

      // vals() returns (5, 7, 0, 0, 0, 0, 0) → b = 7 → v + 1 = 8.
      expect(BigInt(cook(source, { baseDirs: [boundTmpDir] }))).toBe(8n);

      fs.rmSync(boundTmpDir, { recursive: true, force: true });
    });

    // NOTE: mutating an element of an ABI-DECODE-produced array descriptor (`arr[0] = …;`)
    // is a SEPARATE, pre-existing limitation independent of the return-kind classification
    // this fix targets — it reverts `SauceInvalidOperationArgs(0x9b)` (SET_INDEX) both before
    // AND after this fix (confirmed: the read-only case above is what actually distinguishes
    // fixed from unfixed — before the fix it reverted `panic: arithmetic underflow or
    // overflow (0x11)` instead). Not covered here; out of scope for this fix.

    it('negative control: destructuring a SCALAR-only output and returning it bare stays scalar, unaffected', () => {
      const source = `
        import { Pool } from "./Pool.json";
        function helper() {
          const [n, xs] = Pool.at(${BigInt(LIST_ADDR)}n).list();
          return n;
        }
        function main() {
          let v = helper();
          return v + 1n;
        }
      `;

      expect(BigInt(cook(source, { baseDirs: [tmpDir] }))).toBe(10n); // n=9, +1
    });
  });

  // ── documented, STILL-OPEN gap — v1 ONLY (deliberately NOT fixed by this change) ──
  //
  // Passing a dynamic (heap) local as a CALL ARGUMENT into a same-file function is a
  // DIFFERENT (third) instance of the same failure family — NOT addressed by the
  // return-kind fix above. The callee's own parameter is always inferred 'scalar'
  // regardless of what the caller passes (`processFunction`/`processFunctionV12`'s
  // `ctx.setVar(param.name, argType?.kind ?? 'scalar', …)` has no per-call-site inference),
  // and v1's real engine additionally splits a dynamic argument into a separate heap-
  // argument index space (`runtime/Function.sol::_executeFunction`) the compiler never
  // accounts for. Pinned here (still expected to revert) so a regression — or an
  // accidental future fix that should come with its own test update — is noticed, not
  // silently missed. See CLAUDE.md's "Same-file user-function return-kind inference" note.
  //
  // **This gap is v1-ONLY, confirmed via real execution on all three targets** — v12 (the
  // postfix, stack-based dialect) has no structural equivalent of v1's funcHeap/funcValues
  // two-index-space split at all: a v12/svm parameter is just an ordinary EVM stack value
  // (`isParam`, read via SDUP/written via SSWAP — see `saucer-v12.ts`), and a dynamic value
  // there is a single 32-byte descriptor word, not an out-of-band side channel — so there is
  // nothing for a "wrong index space" bug to corrupt. See
  // `compiler/integration-test/v12-execution.test.ts`'s `callarg_*` vectors and
  // `compiler/integration-test/svm-execution.test.ts`'s analogous cases for the passing
  // regression lock — do NOT read this v1-only revert as an engine-agnostic limitation.
  it('KNOWN GAP (unfixed, v1-only): passing a dynamic local as a call argument still reverts on v1', () => {
    const source = `
      function h(a) { return a[1]; }
      function main() {
        const arr = new Array(3);
        arr[0] = 1n;
        arr[1] = 2n;
        arr[2] = 3n;
        return h(arr);
      }
    `;

    expect(() => cook(source)).toThrow();
  });
});
