/**
 * v12 execution parity: TypeScript-compiled v12 bytecode runs correctly on the
 * real engine-v12 Huff runtime — the strongest compiler↔engine guarantee.
 *
 * We generate v12 programs from BOTH the `V12Saucer` builder and the
 * `compile(src, { target: 'v12' })` transpiler, write them to
 * engine-v12/test/V12-execparity/vectors.json, then run `forge test
 * V12ExecParity.t.sol --ffi`, which deploys v12/Runtime.huff and executes every
 * program, asserting the decoded result. Where the bytecode parity test proves
 * "TS builder == Solidity builder", this proves "TS output actually evaluates
 * correctly on the runtime" — including the transpiler path with no Solidity twin.
 *
 * Requires a COMPLETE engine-v12 checkout (test/V12-execparity + lib/forge-std +
 * lib/foundry-huff-neo) plus Foundry and the huff-neo compiler `hnc`. The
 * published `sauce` dep ships a trimmed engine-v12, so by default this skips;
 * point SAUCE_ENGINE_V12 at a full checkout (e.g. ../sauce/engine-v12) to run.
 *
 * Array-mutation programs (arr[i] = x / SET_INDEX / new Array(n)) execute here too:
 * the harness is generic (decodes each vector's scalar result), so a builder vector
 * (newArray + setIndex + index) and transpiler vectors (new Array, literal set, get,
 * compound +=) run on the real runtime and prove the descriptor round-trips through
 * a heap-slot store/read — not just that the bytes are well-formed.
 */
import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compile, V12Saucer } from '../src/index.js';
import { CompilerContext } from '../src/context.js';
import type { ContractsConfig } from '../src/contracts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_V12 = process.env.SAUCE_ENGINE_V12 ?? join(__dirname, '../node_modules/sauce/engine-v12');
const HARNESS = join(ENGINE_V12, 'test/V12-execparity/V12ExecParity.t.sol');
const FORGE_STD = join(ENGINE_V12, 'lib/forge-std');
const HUFF_NEO = join(ENGINE_V12, 'lib/foundry-huff-neo');
const VECTORS_FILE = join(ENGINE_V12, 'test/V12-execparity/vectors.json');

const canRun = (): boolean => {
  try {
    execSync('forge --version', { stdio: 'pipe' });
    execSync('hnc --version', { stdio: 'pipe' }); // huff-neo compiler for Runtime.huff

    return existsSync(HARNESS) && existsSync(FORGE_STD) && existsSync(HUFF_NEO);
  } catch {
    return false;
  }
};

const describeIfForge = canRun() ? describe : describe.skip;

const ctx = () => new CompilerContext([], {}, 'v12');
const hex = (b: Uint8Array): string => '0x' + Buffer.from(b).toString('hex');
const S = (c: CompilerContext) => new V12Saucer(c);
const U = (c: CompilerContext, v: number) => S(c).int(BigInt(v));

interface Vector {
  name: string;
  bytecodeHex: string;
  expectedKind: 'uint' | 'bool' | 'revert';
  expectedUint: number;
}

// Programs built with the V12Saucer builder directly (local slot variables).
const builderVectors: {
  name: string;
  make: (c: CompilerContext) => Uint8Array;
  expected: number;
  kind: 'uint' | 'bool';
}[] = [
  {
    name: 'add',
    make: (c) =>
      S(c)
        .store('sum', S(c).add(U(c, 100), U(c, 50)))
        .read('sum')
        .build(),
    expected: 150,
    kind: 'uint',
  },
  {
    name: 'sub',
    make: (c) =>
      S(c)
        .store('d', S(c).sub(U(c, 100), U(c, 30)))
        .read('d')
        .build(),
    expected: 70,
    kind: 'uint',
  },
  {
    name: 'mul',
    make: (c) =>
      S(c)
        .store('p', S(c).mul(U(c, 12), U(c, 5)))
        .read('p')
        .build(),
    expected: 60,
    kind: 'uint',
  },
  {
    name: 'div',
    make: (c) =>
      S(c)
        .store('q', S(c).div(U(c, 100), U(c, 4)))
        .read('q')
        .build(),
    expected: 25,
    kind: 'uint',
  },
  {
    name: 'exp',
    make: (c) =>
      S(c)
        .store('power', S(c).exp(U(c, 2), U(c, 10)))
        .read('power')
        .build(),
    expected: 1024,
    kind: 'uint',
  },
  {
    name: 'gt',
    make: (c) =>
      S(c)
        .store('cmp', S(c).gt(U(c, 10), U(c, 3)))
        .read('cmp')
        .build(),
    expected: 1,
    kind: 'bool',
  },
  {
    name: 'bitand',
    make: (c) =>
      S(c)
        .store('x', S(c).bitAnd(U(c, 12), U(c, 10)))
        .read('x')
        .build(),
    expected: 8,
    kind: 'uint',
  },
  {
    name: 'shl',
    make: (c) =>
      S(c)
        .store('x', S(c).shl(U(c, 1), U(c, 4)))
        .read('x')
        .build(),
    expected: 16,
    kind: 'uint',
  },
  {
    name: 'ifelse_true',
    make: (c) => {
      const then_ = S(c).store('r', U(c, 100));
      const else_ = S(c).store('r', U(c, 200));

      return (
        S(c)
          .if(S(c).eq(U(c, 5), U(c, 5)))
          .then(then_)
          .else(else_) as V12Saucer
      )
        .read('r')
        .build();
    },
    expected: 100,
    kind: 'uint',
  },
  {
    name: 'storage_roundtrip',
    make: (c) =>
      S(c)
        .sstore(U(c, 7), U(c, 999))
        .store('v', S(c).sload(U(c, 7)))
        .read('v')
        .build(),
    expected: 999,
    kind: 'uint',
  },
  {
    name: 'memvar',
    make: (c) =>
      S(c)
        .store('a', U(c, 10))
        .store('b', U(c, 20))
        .store('s', S(c).add(S(c).read('a'), S(c).read('b')))
        .read('s')
        .build(),
    expected: 30,
    kind: 'uint',
  },
  {
    // a = new Array(3); a[1] = 77; return a[1] — exercises NEW_ARRAY + SET_INDEX
    // (in-place mutate, descriptor written back to the heap slot) + INDEX read.
    name: 'newarray_setindex',
    make: (c) =>
      S(c)
        .store('a', S(c).newArray(U(c, 3)))
        .store('a', S(c).setIndex(S(c).read('a'), U(c, 1), U(c, 77)))
        .store('r', S(c).index(S(c).read('a'), U(c, 1)))
        .read('r')
        .build(),
    expected: 77,
    kind: 'uint',
  },
];

// Programs produced by the transpiler — the path with no Solidity twin.
const transpilerVectors: {
  name: string;
  src: string;
  expected: number;
  kind: 'uint' | 'revert';
  /** Pre-registered contract ABIs (CompileOptions.contracts) for call-based vectors. */
  contracts?: ContractsConfig;
}[] = [
  {
    name: 'func_call_params',
    src: 'function add(a, b){ return a + b } function main(){ return add(10, 20) }',
    expected: 30,
    kind: 'uint',
  },
  { name: 'compile_arith', src: 'function main(){ return 7 * 8 - 6 }', expected: 50, kind: 'uint' },
  {
    name: 'compile_if_else',
    src: 'function main(){ let r = 0; if (5 > 3) { r = 1 } else { r = 2 } return r }',
    expected: 1,
    kind: 'uint',
  },
  {
    name: 'nested_call',
    src: 'function f(x){ return x + 1 } function g(x){ return x * 2 } function main(){ return f(g(3)) }',
    expected: 7,
    kind: 'uint',
  },
  {
    name: 'two_helpers',
    src: 'function inc(x){ return x + 1 } function dbl(x){ return x * 2 } function main(){ return inc(3) + dbl(4) }',
    expected: 12,
    kind: 'uint',
  },
  {
    name: 'call_3args',
    src: 'function add3(a, b, c){ return a + b + c } function main(){ return add3(10, 20, 30) }',
    expected: 60,
    kind: 'uint',
  },
  { name: 'dynamic_length', src: 'function main(){ return "0xdeadbeef".length }', expected: 10, kind: 'uint' },
  { name: 'revert_explicit', src: 'function main(){ throw "0x00" }', expected: 0, kind: 'revert' },
  {
    name: 'while_simple',
    src: 'function main(){ let i = 0; while (i < 3) { i = i + 1 } return i }',
    expected: 3,
    kind: 'uint',
  },
  {
    name: 'while_sum',
    src: 'function main(){ let s = 0; let i = 0; while (i < 5) { s = s + i; i = i + 1 } return s }',
    expected: 10,
    kind: 'uint',
  },
  {
    name: 'for_sum',
    src: 'function main(){ let s = 0; for (let i = 0; i < 5; i = i + 1) { s = s + i } return s }',
    expected: 10,
    kind: 'uint',
  },
  // ── array mutation (NEW_ARRAY / SET_INDEX) — targets must be mutable (TUPLE) ──
  {
    name: 'new_array_zero_init',
    src: 'function main(){ let a = new Array(3); return a[1] }',
    expected: 0, // NEW_ARRAY zero-initializes every slot
    kind: 'uint',
  },
  {
    name: 'array_set_get',
    src: 'function main(){ let a = new Array(3); a[1] = 99; return a[1] }',
    expected: 99, // simple SET_INDEX into a freshly-allocated array, read back
    kind: 'uint',
  },
  {
    name: 'new_array_set_get',
    src: 'function main(){ let a = new Array(3); a[2] = 42; return a[2] }',
    expected: 42, // SET_INDEX at a different slot
    kind: 'uint',
  },
  {
    name: 'array_compound_assign',
    src: 'function main(){ let a = new Array(3); a[0] = 4; a[0] += 10; return a[0] }',
    expected: 14, // compound: INDEX read + ADD + SET_INDEX write
    kind: 'uint',
  },
  {
    name: 'object_field_set',
    src: 'function main(){ let p = { x: 5, y: 9 }; p.x = 42; return p.x }',
    expected: 42, // object literal is a TUPLE (mutable) → SET_INDEX by field index
    kind: 'uint',
  },
  // ── same-file function return-kind inference (regression lock — v12/svm already
  // worked before this fix, for an unrelated reason: V12Saucer.store derives its kind
  // from value.isDynamic, not the _kind parameter inference.ts computes — see CLAUDE.md's
  // "Same-file user-function return-kind inference" note). These lock in that v12 stays
  // correct now that v1 (compiler/integration-test/function-return-kind.test.ts) has been
  // fixed to agree.
  {
    name: 'helper_returns_array_mutate',
    src: `
      function helper() { let a = new Array(3); a[0] = 1; a[1] = 2; a[2] = 3; return a }
      function main() { let arr = helper(); arr[0] = 42; return arr[0] + arr[1] * 10 }
    `,
    expected: 62,
    kind: 'uint',
  },
  {
    name: 'helper_returns_array_readonly',
    src: `
      function helper() { let a = new Array(3); a[0] = 1; a[1] = 2; a[2] = 3; return a }
      function main() { let arr = helper(); return arr[1] }
    `,
    expected: 2,
    kind: 'uint',
  },
  {
    name: 'alias_dynamic_local',
    src: 'function main(){ let a = new Array(3); a[1] = 2; let b = a; b[0] = 42; return b[0] + b[1] * 10 }',
    expected: 62,
    kind: 'uint',
  },
  {
    // A bare value-returning call must be SDROP'd or it leaks on the stack and
    // corrupts the fixed-position return — so a missing drop would make this return
    // 42 (or revert) instead of 7.
    name: 'unused_call_dropped',
    src: 'function noise(x){ return x + 1 } function main(){ noise(41); return 7 }',
    expected: 7,
    kind: 'uint',
  },
  // ── dynamic value passed as a CALL ARGUMENT (regression lock — v12/svm already
  // worked here, UNLIKE v1, which has a known, deliberately-unfixed gap: see
  // CLAUDE.md's "Same-file user-function return-kind inference" note and
  // compiler/integration-test/function-return-kind.test.ts's "KNOWN GAP (unfixed,
  // v1-only)" test. A v12/svm parameter is an ordinary EVM stack value (`isParam`),
  // and a dynamic value there is a single 32-byte descriptor word — there is no
  // out-of-band side channel and no funcHeap/funcValues index-space split the way
  // v1 has, so passing one as an argument is structurally no different from
  // passing a scalar. These vectors prove that, on the real Huff runtime, not just
  // by reasoning about the codegen.
  {
    name: 'callarg_dynamic_read',
    src: `
      function h(a) { return a[1] }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return h(arr);
      }
    `,
    expected: 2,
    kind: 'uint',
  },
  {
    name: 'callarg_dynamic_store_then_use',
    src: `
      function h(a) { let b = a; return b[1] }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return h(arr);
      }
    `,
    expected: 2,
    kind: 'uint',
  },
  {
    name: 'callarg_dynamic_store_then_mutate',
    src: `
      function h(a) { let b = a; b[0] = 9; return b[0] + b[1] * 10 }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return h(arr);
      }
    `,
    expected: 29, // 9 + 2*10
    kind: 'uint',
  },
  {
    name: 'callarg_two_alias_hops',
    src: `
      function h(a) { let b = a; let c = b; return c[1] }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return h(arr);
      }
    `,
    expected: 2,
    kind: 'uint',
  },
  {
    name: 'callarg_dynamic_then_scalar',
    src: `
      function h(a, s) { return a[1] + s }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return h(arr, 21);
      }
    `,
    expected: 23,
    kind: 'uint',
  },
  {
    name: 'callarg_scalar_then_dynamic',
    src: `
      function h(s, a) { return s + a[1] }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return h(21, arr);
      }
    `,
    expected: 23,
    kind: 'uint',
  },
  {
    name: 'callarg_helper_chain',
    src: `
      function inner(a) { return a[1] }
      function outer(a) { return inner(a) }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return outer(arr);
      }
    `,
    expected: 2,
    kind: 'uint',
  },
  {
    name: 'callarg_param_length',
    src: `
      function h(a) { return a.length }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return h(arr);
      }
    `,
    expected: 3,
    kind: 'uint',
  },
  {
    name: 'callarg_helper_return_as_arg',
    src: `
      function f() { let a = new Array(2); a[0] = 3; a[1] = 8; return a }
      function g(a) { return a[1] }
      function main() { return g(f()) }
    `,
    expected: 8,
    kind: 'uint',
  },
  {
    // A dynamic ARGUMENT round-tripping through a RECURSIVE call — combines the
    // (v1-only) call-argument gap with recursion, on a target where neither is a
    // problem: v12/svm has no per-call-site kind gap and this fixpoint composes
    // fine with recursion (see the self/mutual-recursion return-kind vectors above
    // — this is the analogous ARGUMENT-direction shape).
    name: 'callarg_recursive_argument',
    src: `
      function walk(a, n) {
        if (n === 0) { return a[1] }
        return walk(a, n - 1);
      }
      function main() {
        const arr = new Array(2);
        arr[0] = 1; arr[1] = 4;
        return walk(arr, 3);
      }
    `,
    expected: 4,
    kind: 'uint',
  },
  // ── recursive same-file function returning a DYNAMIC value (regression lock —
  // both the return-kind fixpoint's convergence through a cycle and the runtime
  // descriptor round-trip through a recursive RETURN are already correct on
  // v12/svm; see function-return-kind.test.ts for the v1-side proof of the exact
  // same shapes).
  {
    name: 'self_recursive_dynamic_return',
    src: `
      function build(n) {
        if (n === 0) {
          let a = new Array(3);
          a[0] = 5;
          return a;
        }
        let inner = build(n - 1);
        return inner;
      }
      function main() { let r = build(2); return r[0] }
    `,
    expected: 5,
    kind: 'uint',
  },
  {
    name: 'mutual_recursive_dynamic_return',
    src: `
      function isEven(n) {
        if (n === 0) {
          let a = new Array(1);
          a[0] = 5;
          return a;
        }
        return isOdd(n - 1);
      }
      function isOdd(n) {
        if (n === 0) {
          let a = new Array(1);
          a[0] = 9;
          return a;
        }
        return isEven(n - 1);
      }
      function main() { let r = isEven(4); return r[0] }
    `,
    expected: 5,
    kind: 'uint',
  },
  // ── v12/svm parameter-WRITE fix regression lock (saucer-v12.ts's `store()`
  // isParam branch — see CLAUDE.md's "v12/svm parameter WRITE" note). Before the
  // fix, EVERY one of these silently computed the wrong SSWAP target: a plain
  // scalar write returned the PRE-write value with NO revert at all (proven via a
  // one-byte bytecode patch before any source-level fix existed), and a dynamic
  // (element) write reverted outright.
  {
    name: 'param_write_scalar_in_helper',
    src: 'function h(x){ x = x + 1; return x } function main(){ return h(5) }',
    expected: 6,
    kind: 'uint',
  },
  {
    name: 'param_write_middle_of_three',
    src: 'function h(a, b, c){ b = 100; return a + b + c } function main(){ return h(1, 2, 3) }',
    expected: 104, // 1 + 100 + 3
    kind: 'uint',
  },
  {
    name: 'param_write_inside_if',
    src: 'function h(x, cond){ if (cond === 1) { x = 15 } return x } function main(){ return h(5, 1) }',
    expected: 15,
    kind: 'uint',
  },
  {
    name: 'param_write_inside_while',
    src: 'function h(x){ let i = 0; while (i < 3) { x = x + 1; i = i + 1 } return x } function main(){ return h(5) }',
    expected: 8, // 5 + 1 + 1 + 1
    kind: 'uint',
  },
  {
    name: 'param_write_twice',
    src: 'function h(x){ x = x + 1; x = x + 1; return x } function main(){ return h(10) }',
    expected: 12,
    kind: 'uint',
  },
  {
    name: 'param_write_dynamic_element',
    src: `
      function h(a) { a[0] = 9; return a[0] }
      function main() {
        const arr = new Array(3);
        arr[0] = 1; arr[1] = 2; arr[2] = 3;
        return h(arr);
      }
    `,
    expected: 9,
    kind: 'uint',
  },
  {
    name: 'param_write_two_frames_deep',
    src: `
      function inner(a) { a[0] = 9; return a[0] }
      function outer(a) { return inner(a) }
      function main() {
        const arr = new Array(2);
        arr[0] = 1; arr[1] = 2;
        return outer(arr);
      }
    `,
    expected: 9,
    kind: 'uint',
  },
  {
    // Compound assignment (`+=`) on a dynamic PARAMETER's element — a v1-only KNOWN GAP
    // (compiler/integration-test/dynamic-kind-sweep.test.ts pins the v1 revert); on v12
    // this is just the ordinary INDEX-read + SET_INDEX-write pattern through a stack param.
    name: 'callarg_compound_assign_on_param',
    src: `
      function h(a) { a[0] += 10; return a[0] }
      function main() {
        const arr = new Array(1);
        arr[0] = 2;
        return h(arr);
      }
    `,
    expected: 12,
    kind: 'uint',
  },
  {
    // The v1-only SILENT-wrong-answer half of the call-argument gap (a string param's
    // `.length` reads the scalar word width, 32, instead of the real length) — v12/svm
    // read the correct length through an ordinary stack param.
    name: 'callarg_string_param_length',
    src: 'function h(s){ return s.length } function main(){ return h("AB") }',
    expected: 2,
    kind: 'uint',
  },
  {
    // The destructuring fast path's building block, executed on the real runtime:
    // CAST_BE(SLICE(bytes, k*32 + (32-N), N)) must equal the canonical
    // low-N-bytes form ABI_DECODE's ad_scalar mask produces. Two head words —
    // word 0 a uint160-shaped value (0x42, slice(12, 32) → 20 bytes), word 1 a
    // SIGN-EXTENDED negative int24 (-100 = NOT(0x63); slice(61, 64) → 0xffff9c).
    name: 'slice_cast_be_word_extract',
    src: `function main(){ const w = Uint8Array.from([${[...Array(31).fill(0), 0x42, ...Array(31).fill(0xff), 0x9c].join(',')}]); return uint(w.slice(12, 32)) * 16777216 + uint(w.slice(61, 64)) }`,
    expected: 0x42 * 16777216 + 0xffff9c,
    kind: 'uint',
  },
  {
    // END-TO-END destructuring fast path on the real runtime, through the actual
    // processDestructuringDeclaration emission (not the .slice()/uint() sugar the
    // vector above uses): STATIC to the identity precompile (0x04) echoes the
    // calldata, so the "returndata" is fully deterministic — bytes 0..3 selector,
    // 4..35 x, 36..67 y, 68..99 z. Binding c (uint32, k=1) slices bytes 60..63 =
    // y[24..27] = 0x51525354; binding f (bool, k=2) slices byte 95 = z[27] = 1.
    // Value-sensitive to the SLICE operand ORDER and the offset/width math: a
    // swapped-operand mutant produces a len-60 slice → CAST_BE reverts.
    name: 'destructure_fastpath_echo',
    src: 'function main(){ const [, c, f] = Echo.at(4).id(1, 0x5152535400000000n, 0x100000000n); return c * 2 + f }',
    expected: 0x51525354 * 2 + 1,
    kind: 'uint',
    contracts: {
      Echo: {
        abi: [
          {
            type: 'function',
            name: 'id',
            inputs: [
              { name: 'x', type: 'uint256' },
              { name: 'y', type: 'uint256' },
              { name: 'z', type: 'uint256' },
            ],
            outputs: [
              { name: 'a', type: 'uint256' },
              { name: 'c', type: 'uint32' },
              { name: 'f', type: 'bool' },
            ],
            stateMutability: 'view',
          },
        ],
      },
    },
  },
  // ── ADVERSARIAL-AUDIT FINDING (this branch): object-literal field applying a
  // SCALAR-producing postfix op to a dynamic base — v12/svm false positive ──
  //
  // `assertNoDynamicVariableObjectField` (processor/collection.ts) used to reject this
  // shape on v12/svm with a compile-time error (`bytes[0] === OPS.READ_HEAP`, true for
  // `arr.length`'s postfix encoding `[READ_HEAP, slot, LENGTH]` even though the overall
  // expression is a genuine scalar) — so before the fix, this vector wouldn't even
  // COMPILE on `target: 'v12'`, let alone execute. Fixed by also requiring
  // `_bytes.length === 2` (a bare dynamic-variable read is always exactly 2 bytes on
  // every target). See test/struct.test.ts's "object literal field applying a
  // SCALAR-producing postfix op" describe block for the compile-time-shape proof (both
  // targets, plus the negative controls proving a genuine bare dynamic-variable read is
  // STILL correctly rejected); this vector proves the fixed shape not only compiles but
  // executes CORRECTLY on the real Huff runtime.
  {
    name: 'object_field_length_of_dynamic_var',
    src: `
      function main(){
        let a = new Array(3);
        a[0] = 11;
        a[1] = 22;
        a[2] = 33;
        let s = { x: a.length, y: 5 };
        return s.x;
      }
    `,
    expected: 3,
    kind: 'uint',
  },
];

function buildVectors(): Vector[] {
  const out: Vector[] = [];
  for (const v of builderVectors) {
    out.push({ name: v.name, bytecodeHex: hex(v.make(ctx())), expectedKind: v.kind, expectedUint: v.expected });
  }
  for (const v of transpilerVectors) {
    const bc = compile(v.src, { target: 'v12', contracts: v.contracts }).bytecode[0];
    out.push({ name: v.name, bytecodeHex: hex(bc), expectedKind: v.kind, expectedUint: v.expected });
  }

  return out;
}

describeIfForge('v12 execution parity (TS bytecode on the Huff runtime)', () => {
  let vectors: Vector[];
  let forgeOutput = '';
  let forgeOk = false;

  beforeAll(() => {
    vectors = buildVectors();
    writeFileSync(VECTORS_FILE, JSON.stringify({ count: vectors.length, vectors }, null, 2) + '\n');
    try {
      forgeOutput = execSync('forge test --match-path test/V12-execparity/V12ExecParity.t.sol --ffi -vv 2>&1', {
        cwd: ENGINE_V12,
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
      });
      forgeOk = true;
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      forgeOutput = err.stdout ?? err.stderr ?? err.message ?? String(e);
      forgeOk = false;
    }
  }, 300_000);

  it('generates vectors across builder and transpiler paths', () => {
    const names = new Set(vectors.map((v) => v.name));
    expect(names.has('add')).toBe(true); // builder path
    expect(names.has('func_call_params')).toBe(true); // transpiler path
    expect(names.has('nested_call')).toBe(true); // multi-helper offset accumulation
    expect(names.has('revert_explicit')).toBe(true); // revert path
    expect(names.has('for_sum')).toBe(true); // loop back-jump arithmetic
    expect(names.has('newarray_setindex')).toBe(true); // builder array mutation
    expect(names.has('array_compound_assign')).toBe(true); // transpiler array mutation
    expect(names.has('helper_returns_array_mutate')).toBe(true); // same-file return-kind inference
    expect(names.has('callarg_dynamic_read')).toBe(true); // dynamic call-argument regression lock
    expect(names.has('param_write_scalar_in_helper')).toBe(true); // param-write fix regression lock
    expect(names.has('object_field_length_of_dynamic_var')).toBe(true); // postfix false-positive fix regression lock
    expect(vectors.length).toBeGreaterThanOrEqual(25);
  });

  it('all vectors execute on the Huff runtime with expected results', () => {
    if (!forgeOk) throw new Error(`forge execution-parity test failed:\n${forgeOutput}`);

    expect(forgeOutput).toMatch(/Suite result: ok\./);
    expect(forgeOutput).toMatch(/ok add /);
    expect(forgeOutput).toMatch(/ok\(revert\) revert_explicit/);
    expect(forgeOutput).toMatch(/ok newarray_setindex 77/); // builder array mutation
    expect(forgeOutput).toMatch(/ok array_compound_assign 14/); // transpiler compound +=
    expect(forgeOutput).toMatch(/ok object_field_set 42/); // object-literal (TUPLE) field set
    expect(forgeOutput).toMatch(/ok unused_call_dropped 7/); // bare call result SDROP'd, stack balanced
    expect(forgeOutput).toMatch(/ok slice_cast_be_word_extract 1124073372/); // destructuring fast-path word extraction (incl. signed intN)
    expect(forgeOutput).toMatch(/ok destructure_fastpath_echo 2728699561/); // = 0x51525354*2+1 — end-to-end fast path via identity precompile (operand-order-sensitive)
    expect(forgeOutput).toMatch(/ok helper_returns_array_mutate 62/); // same-file function return-kind inference (regression lock)
    expect(forgeOutput).toMatch(/ok helper_returns_array_readonly 2/);
    expect(forgeOutput).toMatch(/ok alias_dynamic_local 62/);
    // dynamic call-argument passing (regression lock — v1-only known gap, see
    // function-return-kind.test.ts's "KNOWN GAP (unfixed, v1-only)" test)
    expect(forgeOutput).toMatch(/ok callarg_dynamic_read 2/);
    expect(forgeOutput).toMatch(/ok callarg_dynamic_store_then_use 2/);
    expect(forgeOutput).toMatch(/ok callarg_dynamic_store_then_mutate 29/);
    expect(forgeOutput).toMatch(/ok callarg_two_alias_hops 2/);
    expect(forgeOutput).toMatch(/ok callarg_dynamic_then_scalar 23/);
    expect(forgeOutput).toMatch(/ok callarg_scalar_then_dynamic 23/);
    expect(forgeOutput).toMatch(/ok callarg_helper_chain 2/);
    expect(forgeOutput).toMatch(/ok callarg_param_length 3/);
    expect(forgeOutput).toMatch(/ok callarg_helper_return_as_arg 8/);
    expect(forgeOutput).toMatch(/ok callarg_recursive_argument 4/);
    expect(forgeOutput).toMatch(/ok self_recursive_dynamic_return 5/);
    expect(forgeOutput).toMatch(/ok mutual_recursive_dynamic_return 5/);
    // v12/svm parameter-WRITE fix (saucer-v12.ts store()'s isParam branch)
    expect(forgeOutput).toMatch(/ok param_write_scalar_in_helper 6/);
    expect(forgeOutput).toMatch(/ok param_write_middle_of_three 104/);
    expect(forgeOutput).toMatch(/ok param_write_inside_if 15/);
    expect(forgeOutput).toMatch(/ok param_write_inside_while 8/);
    expect(forgeOutput).toMatch(/ok param_write_twice 12/);
    expect(forgeOutput).toMatch(/ok param_write_dynamic_element 9/);
    expect(forgeOutput).toMatch(/ok param_write_two_frames_deep 9/);
    expect(forgeOutput).toMatch(/ok callarg_compound_assign_on_param 12/);
    expect(forgeOutput).toMatch(/ok callarg_string_param_length 2/);
    // object-literal field applying a scalar-producing postfix op to a dynamic base
    // (adversarial-audit fix — was a compile-time false positive on v12/svm)
    expect(forgeOutput).toMatch(/ok object_field_length_of_dynamic_var 3/);
    expect(forgeOutput).not.toMatch(/\[FAIL/);
  });
});
