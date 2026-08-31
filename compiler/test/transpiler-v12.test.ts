/**
 * Transpiler → v12 target: `compile(src, { target: 'v12' })`.
 *
 * Mirrors the strategy of the v1 transpiler tests: compile a SauceScript snippet
 * and assert the emitted v12 (postfix/stack) bytecode is byte-identical to an
 * equivalent hand-built `V12Saucer` chain. Both sides go through the same emitter,
 * so this pins the transpiler's lowering decisions (operand order, MSTORE
 * insertion, scalar-vs-dynamic tracking, slot-vs-stack variable access) rather
 * than hard-coding hex.
 *
 * SauceScript here is the LOCAL surface (namespaced `storage.write`, `ctx.msgSender()`,
 * `crypto.keccak256`, `contract.call`, `Math.*`), not the prototype's uppercase
 * builtins — so signed ops (no local surface) are covered by the builder unit
 * suite (saucer-v12.test.ts) instead (CAST_BE's surface, uint(), is pinned per
 * target in svm-target.test.ts). Multi-function (helper) cases assert against
 * captured hex (the cross-function assembly is validated end-to-end by the engine
 * execution + Solidity-parity integration suites).
 */
import { compile, V12Saucer, OPS, OPS_V12 } from '../src/index.js';
import { CompilerContext } from '../src/context.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const v12ctx = () => new CompilerContext([], {}, 'v12');
const mk = (c: CompilerContext) => new V12Saucer(c);
const compileV12 = (src: string): string => hex(compile(src, { target: 'v12' }).bytecode[0]);

interface Case {
  name: string;
  src: string;
  ref: (c: CompilerContext) => V12Saucer;
}

const cases: Record<string, Case[]> = {
  Literals: [
    { name: 'number literal', src: 'function main(){ return 42 }', ref: (c) => mk(c).int(42n) },
    { name: 'bigint literal', src: 'function main(){ return 1000000n }', ref: (c) => mk(c).int(1000000n) },
    { name: 'boolean true → 1', src: 'function main(){ return true }', ref: (c) => mk(c).int(1n) },
    { name: 'boolean false → 0', src: 'function main(){ return false }', ref: (c) => mk(c).int(0n) },
    { name: 'string (UTF-8 bytes)', src: 'function main(){ return "0xbeef" }', ref: (c) => mk(c).string('0xbeef') },
  ],

  Context: [
    {
      name: 'ctx.msgSender() (formerly msg.sender)',
      src: 'function main(){ return ctx.msgSender() }',
      ref: (c) => mk(c).msgSender(),
    },
    {
      name: 'ctx.timestamp() (formerly block.timestamp)',
      src: 'function main(){ return ctx.timestamp() }',
      ref: (c) => mk(c).blockTimestamp(),
    },
    {
      name: 'ctx.chainId() (formerly block.chainId)',
      src: 'function main(){ return ctx.chainId() }',
      ref: (c) => mk(c).blockChainId(),
    },
    {
      name: 'ctx.self() (formerly address.self)',
      src: 'function main(){ return ctx.self() }',
      ref: (c) => mk(c).addressSelf(),
    },
    { name: 'gasLeft()', src: 'function main(){ return gasLeft() }', ref: (c) => mk(c).gasLeft() },
    {
      name: 'ctx.balance(ctx.self()) (formerly address.balanceOf(address.self))',
      src: 'function main(){ return ctx.balance(ctx.self()) }',
      ref: (c) => mk(c).balanceOf(mk(c).addressSelf()),
    },
  ],

  Arithmetic: [
    { name: 'add', src: 'function main(){ return 5 + 3 }', ref: (c) => mk(c).add(mk(c).int(5n), mk(c).int(3n)) },
    { name: 'sub (swap)', src: 'function main(){ return 5 - 3 }', ref: (c) => mk(c).sub(mk(c).int(5n), mk(c).int(3n)) },
    { name: 'mul', src: 'function main(){ return 7 * 8 }', ref: (c) => mk(c).mul(mk(c).int(7n), mk(c).int(8n)) },
    {
      name: 'div (swap)',
      src: 'function main(){ return 10 / 2 }',
      ref: (c) => mk(c).div(mk(c).int(10n), mk(c).int(2n)),
    },
    {
      name: 'mod (swap)',
      src: 'function main(){ return 10 % 3 }',
      ref: (c) => mk(c).mod(mk(c).int(10n), mk(c).int(3n)),
    },
    {
      name: 'exp (swap)',
      src: 'function main(){ return 2 ** 10 }',
      ref: (c) => mk(c).exp(mk(c).int(2n), mk(c).int(10n)),
    },
    { name: 'Math.sqrt', src: 'function main(){ return Math.sqrt(16) }', ref: (c) => mk(c).sqrt(mk(c).int(16n)) },
    {
      name: 'Math.mulDiv',
      src: 'function main(){ return Math.mulDiv(10, 20, 5) }',
      ref: (c) => mk(c).mulDiv(mk(c).int(10n), mk(c).int(20n), mk(c).int(5n)),
    },
    { name: 'Math.neg', src: 'function main(){ return Math.neg(5) }', ref: (c) => mk(c).neg(mk(c).int(5n)) },
    // §1.9 compiler-parity: signed / modular Math.* intrinsics on v12.
    {
      name: 'Math.addMod',
      src: 'function main(){ return Math.addMod(10, 20, 5) }',
      ref: (c) => mk(c).addMod(mk(c).int(10n), mk(c).int(20n), mk(c).int(5n)),
    },
    {
      name: 'Math.mulMod',
      src: 'function main(){ return Math.mulMod(6, 7, 5) }',
      ref: (c) => mk(c).mulMod(mk(c).int(6n), mk(c).int(7n), mk(c).int(5n)),
    },
    {
      name: 'Math.sDiv (swap)',
      src: 'function main(){ return Math.sDiv(10, 3) }',
      ref: (c) => mk(c).sDiv(mk(c).int(10n), mk(c).int(3n)),
    },
    {
      name: 'Math.sMod (swap)',
      src: 'function main(){ return Math.sMod(10, 3) }',
      ref: (c) => mk(c).sMod(mk(c).int(10n), mk(c).int(3n)),
    },
    {
      name: 'Math.sShr',
      src: 'function main(){ return Math.sShr(64, 2) }',
      ref: (c) => mk(c).sShr(mk(c).int(64n), mk(c).int(2n)),
    },
    {
      name: 'Math.signExtend',
      src: 'function main(){ return Math.signExtend(200, 0) }',
      ref: (c) => mk(c).signExtend(mk(c).int(200n), mk(c).int(0n)),
    },
    {
      name: 'Math.sLt (swap)',
      src: 'function main(){ return Math.sLt(3, 5) }',
      ref: (c) => mk(c).sLt(mk(c).int(3n), mk(c).int(5n)),
    },
    {
      name: 'Math.sGt (swap)',
      src: 'function main(){ return Math.sGt(3, 5) }',
      ref: (c) => mk(c).sGt(mk(c).int(3n), mk(c).int(5n)),
    },
    {
      name: 'Math.sLte (swap)',
      src: 'function main(){ return Math.sLte(3, 5) }',
      ref: (c) => mk(c).sLte(mk(c).int(3n), mk(c).int(5n)),
    },
    {
      name: 'Math.sGte (swap)',
      src: 'function main(){ return Math.sGte(3, 5) }',
      ref: (c) => mk(c).sGte(mk(c).int(3n), mk(c).int(5n)),
    },
    {
      name: 'nested (a+b)*(c-d)',
      src: 'function main(){ return (1 + 2) * (5 - 3) }',
      ref: (c) => mk(c).mul(mk(c).add(mk(c).int(1n), mk(c).int(2n)), mk(c).sub(mk(c).int(5n), mk(c).int(3n))),
    },
  ],

  Comparison: [
    { name: 'eq', src: 'function main(){ return 1 === 2 }', ref: (c) => mk(c).eq(mk(c).int(1n), mk(c).int(2n)) },
    { name: 'neq', src: 'function main(){ return 1 !== 2 }', ref: (c) => mk(c).neq(mk(c).int(1n), mk(c).int(2n)) },
    { name: 'lt (swap)', src: 'function main(){ return 1 < 9 }', ref: (c) => mk(c).lt(mk(c).int(1n), mk(c).int(9n)) },
    { name: 'gt (swap)', src: 'function main(){ return 5 > 3 }', ref: (c) => mk(c).gt(mk(c).int(5n), mk(c).int(3n)) },
    {
      name: 'lte (swap)',
      src: 'function main(){ return 1 <= 9 }',
      ref: (c) => mk(c).lte(mk(c).int(1n), mk(c).int(9n)),
    },
    {
      name: 'gte (swap)',
      src: 'function main(){ return 5 >= 3 }',
      ref: (c) => mk(c).gte(mk(c).int(5n), mk(c).int(3n)),
    },
  ],

  Bitwise: [
    {
      name: 'and',
      src: 'function main(){ return 255 & 15 }',
      ref: (c) => mk(c).bitAnd(mk(c).int(255n), mk(c).int(15n)),
    },
    { name: 'or', src: 'function main(){ return 255 | 15 }', ref: (c) => mk(c).bitOr(mk(c).int(255n), mk(c).int(15n)) },
    {
      name: 'xor',
      src: 'function main(){ return 255 ^ 15 }',
      ref: (c) => mk(c).bitXor(mk(c).int(255n), mk(c).int(15n)),
    },
    { name: 'not (~)', src: 'function main(){ return ~5 }', ref: (c) => mk(c).bitNot(mk(c).int(5n)) },
    { name: 'shl', src: 'function main(){ return 1 << 4 }', ref: (c) => mk(c).shl(mk(c).int(1n), mk(c).int(4n)) },
    { name: 'shr', src: 'function main(){ return 256 >> 4 }', ref: (c) => mk(c).shr(mk(c).int(256n), mk(c).int(4n)) },
  ],

  Logical: [
    {
      name: 'and (&&)',
      src: 'function main(){ return true && false }',
      ref: (c) => mk(c).and(mk(c).int(1n), mk(c).int(0n)),
    },
    {
      name: 'or (||)',
      src: 'function main(){ return true || false }',
      ref: (c) => mk(c).or(mk(c).int(1n), mk(c).int(0n)),
    },
    { name: 'not (!)', src: 'function main(){ return !true }', ref: (c) => mk(c).not(mk(c).int(1n)) },
  ],

  Storage: [
    {
      name: 'storage.write',
      src: 'function main(){ storage.write(0, 42) }',
      ref: (c) => mk(c).sstore(mk(c).int(0n), mk(c).int(42n)),
    },
    { name: 'storage.read', src: 'function main(){ return storage.read(0) }', ref: (c) => mk(c).sload(mk(c).int(0n)) },
    {
      name: 'storage.tWrite',
      src: 'function main(){ storage.tWrite(1, 99) }',
      ref: (c) => mk(c).tstore(mk(c).int(1n), mk(c).int(99n)),
    },
    {
      name: 'storage.tRead',
      src: 'function main(){ return storage.tRead(1) }',
      ref: (c) => mk(c).tload(mk(c).int(1n)),
    },
  ],

  Memory: [
    {
      name: 'local const scalar',
      src: 'function main(){ const x = 42; return x }',
      ref: (c) => mk(c).store('x', mk(c).int(42n)).read('x'),
    },
    {
      name: 'local let scalar',
      src: 'function main(){ let x = 42; return x }',
      ref: (c) => mk(c).store('x', mk(c).int(42n)).read('x'),
    },
  ],

  DynamicData: [
    {
      name: 'crypto.keccak256',
      src: 'function main(){ return crypto.keccak256("0xbeef") }',
      ref: (c) => mk(c).keccak256(mk(c).string('0xbeef')),
    },
    {
      name: 'abi.encode(obj)',
      src: 'function main(){ return abi.encode({ a: 1, b: 2 }) }',
      ref: (c) => mk(c).abiEncode(mk(c).tuple([mk(c).int(1n), mk(c).int(2n)])),
    },
    {
      name: 'array literal',
      src: 'function main(){ return [1, 2, 3] }',
      ref: (c) => mk(c).array([mk(c).int(1n), mk(c).int(2n), mk(c).int(3n)]),
    },
    {
      name: 'object literal → tuple',
      src: 'function main(){ const o = { a: 1, b: 2 }; return o }',
      ref: (c) =>
        mk(c)
          .store('o', mk(c).tuple([mk(c).int(1n), mk(c).int(2n)]))
          .read('o'),
    },
  ],

  ControlFlow: [
    {
      // ctx.chainId() > 0 (not a literal) so the condition isn't const-foldable — this
      // case pins generic if/else codegen shape, not folding.
      name: 'if/else statement',
      src: 'function main(){ if (ctx.chainId() > 0) { storage.write(0, 1) } else { storage.write(0, 2) } }',
      ref: (c) =>
        mk(c)
          .if(mk(c).gt(mk(c).blockChainId(), mk(c).int(0n)))
          .then(mk(c).sstore(mk(c).int(0n), mk(c).int(1n)))
          .else(mk(c).sstore(mk(c).int(0n), mk(c).int(2n))) as V12Saucer,
    },
    {
      name: 'throw (revert)',
      src: 'function main(){ throw "0x00" }',
      ref: (c) => mk(c).revert(mk(c).string('0x00')),
    },
  ],
};

// Param-mains: main params live on the stack; replicate compile()'s main-ref
// SDUP patching (realPos = depth + paramCount - paramIndex, no frame offset).
interface ParamCase {
  name: string;
  src: string;
  params: string[];
  ref: (c: CompilerContext) => V12Saucer;
}

const paramCases: ParamCase[] = [
  {
    name: 'scalar param a + 1',
    src: 'function main(a){ return a + 1 }',
    params: ['a'],
    ref: (c) => mk(c).add(mk(c).read('a'), mk(c).int(1n)),
  },
  {
    name: 'two params a + b',
    src: 'function main(a, b){ return a + b }',
    params: ['a', 'b'],
    ref: (c) => mk(c).add(mk(c).read('a'), mk(c).read('b')),
  },
  {
    name: 'ctx.isContract(param) (formerly address.isContract(param))',
    src: 'function main(a){ return ctx.isContract(a) }',
    params: ['a'],
    ref: (c) => mk(c).isContract(mk(c).read('a')),
  },
  {
    name: 'crypto.ecdsaVerify(params)',
    src: 'function main(s, h, sig){ return crypto.ecdsaVerify(s, h, sig) }',
    params: ['s', 'h', 'sig'],
    ref: (c) => mk(c).ecdsaVerify(mk(c).read('s'), mk(c).read('h'), mk(c).read('sig')),
  },
  {
    name: 'contract.call(param, 0, data)',
    src: 'function main(target){ return contract.call(target, 0, "data") }',
    params: ['target'],
    ref: (c) => mk(c).externalCall(mk(c).read('target'), mk(c).int(0n), mk(c).string('data')),
  },
];

// Multi-function cases — captured hex (assembly validated by the integration suites).
// A helper `return` now self-terminates with FUNC_RETURN (0xf3) so an EARLY return
// inside a conditional exits instead of leaking its value and falling through; the
// assembly's trailing per-helper FUNC_RETURN follows as (dead, unreachable) code.
// (In the two-helper case the inc body's extra 0xf3 also shifts dbl's CALL_FUNCTION
// jump offset 0x0011→0x0012.)
const helperCases: { name: string; src: string; hex: string }[] = [
  {
    name: 'single-arg helper + call',
    src: 'function inc(n){ return n + 1n } function main(){ return inc(5n) }',
    hex: '010599000801f200d1010121f3f3',
  },
  {
    name: 'two-arg helper + call',
    src: 'function add(a, b){ return a + b } function main(){ return add(3n, 7n) }',
    hex: '0103010799000a02f200d2d221f3f3',
  },
  {
    name: 'two helpers + nested call',
    src: 'function inc(n){ return n + 1n } function dbl(n){ return n * 2n } function main(){ return inc(dbl(5n)) }',
    hex: '01059900120199000c01f200d1010121f3f3d1010223f3f3',
  },
];

describe("Transpiler — v12 target (compile(src, { target: 'v12' }))", () => {
  for (const [category, list] of Object.entries(cases)) {
    describe(category, () => {
      for (const c of list) {
        it(c.name, () => {
          // A single-function (main-only) program assembles as main's buildMain()
          // bytes — the ALLOCATE frame-stride prefix (when main uses slots) plus the
          // result-MSTORE — exactly what assembleV12 returns for the no-helper case.
          expect(compileV12(c.src)).toBe(hex(c.ref(v12ctx()).buildMain().bytes));
        });
      }
    });
  }

  describe('Param mains (stack params)', () => {
    for (const c of paramCases) {
      it(c.name, () => {
        const ctx = v12ctx();
        for (const n of c.params) {
          ctx.setVar(n, 'scalar', undefined, undefined, true);
          ctx.pushStack(n);
        }
        const m = c.ref(ctx);
        const bc = new Uint8Array(m.build());
        // Patch main REF sentinels (no frame-pointer offset), as assembleV12 does.
        for (const ref of m.refPositions) {
          bc[ref.position] = OPS_V12.SDUP1 + (ref.depth + c.params.length - ref.paramIndex) - 1;
        }
        expect(compileV12(c.src)).toBe(hex(bc));
      });
    }
  });

  describe('Functions (multi-function assembly)', () => {
    for (const c of helperCases) {
      it(c.name, () => {
        expect(compileV12(c.src)).toBe(c.hex);
      });
    }

    it('early return inside a helper emits its own FUNC_RETURN (no stack leak)', () => {
      // A helper with an EARLY return inside an `if` must terminate that path with
      // FUNC_RETURN (0xf3) — otherwise the value is left on the stack and execution
      // falls through into the rest of the body, leaking a stack item per call (a
      // loop of such calls → EVM "out of stack" on the v12 runtime). Both the early
      // and the tail return self-terminate, so the body carries TWO 0xf3 returns
      // (plus the assembly's trailing dead one). main is INLINED — it must NOT emit a
      // helper FUNC_RETURN, so its body has no 0xf3.
      const src = 'function clamp(x){ if (x > 10n) { return 10n } return x } function main(){ return clamp(5n) }';
      const bc = compileV12(src);
      const funcReturns = (bc.match(/f3/g) ?? []).length;
      // 2 in-body returns (early + tail) + 1 trailing assembly FUNC_RETURN = 3.
      expect(funcReturns).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Array mutation (SET_INDEX / NEW_ARRAY)', () => {
    // Captured v12 (postfix) bytecode — the full program assembly (slot allocation,
    // store, return MSTORE) is validated end-to-end by the engine integration
    // suites; here we pin the lowering to SET_INDEX/NEW_ARRAY chains. Element
    // assignment targets a MUTABLE collection (new Array → TUPLE, or an object
    // literal → TUPLE); static packed array literals are immutable (see the guard
    // test below) so they are not valid targets.
    // Each main here uses heap slots (new Array / object literal → TUPLE), so it leads
    // with main's ALLOCATE_HEAP frame-stride prefix (`c2 <heapSlots>`); the compound
    // case also declares 1 VALUE slot (`let i`) → `c0 01` precedes the `c2 01`.
    const arrayCases: { name: string; src: string; hex: string }[] = [
      {
        name: 'new Array(n) → [count][NEW_ARRAY]',
        src: 'function main(){ let a = new Array(3); return a }',
        hex: 'c20101039cc3009800',
      },
      {
        name: 'arr[i] = x on new Array → SET_INDEX, postfix [value][index][array]',
        src: 'function main(){ let a = new Array(3); a[1] = 9; return a }',
        hex: 'c20101039cc3000109010198009bc3009800',
      },
      {
        name: 'obj.field = x → SET_INDEX with field-index UINT (object literal is a TUPLE)',
        src: 'function main(){ let p = { x: 1, y: 2 }; p.x = 9; return p }',
        hex: 'c201010201019402c3000109010098009bc3009800',
      },
      {
        name: 'compound arr[i] += y on new Array → INDEX read + SET_INDEX write',
        src: 'function main(){ let a = new Array(3); let i = 1; a[i] += 5; return a }',
        hex: 'c001c20101039cc3000101c1005000980097010521500098009bc3009800',
      },
    ];

    for (const c of arrayCases) {
      it(c.name, () => {
        expect(compileV12(c.src)).toBe(c.hex);
      });
    }

    it('compound with a side-effecting index evaluates it exactly once', () => {
      // `a[f()] += 5`: the index feeds both the INDEX read and the SET_INDEX write.
      // A non-pure index is hoisted into a scratch local, so f() (CALL_FUNCTION) is
      // emitted ONCE — not duplicated into both subtrees. f()'s own body has no call.
      const bc = compile('function f(){ return 1 } function main(){ let a = new Array(3); a[f()] += 5; return a[0] }', {
        target: 'v12',
      }).bytecode[0];
      const calls = bc.filter((b) => b === OPS.CALL_FUNCTION).length;
      expect(calls).toBe(1);
    });

    it('rejects element assignment to an immutable packed array literal', () => {
      // `[1, 2, 3]` packs to a static array the engine reverts SET_INDEX on; reject
      // it at compile time and point at the mutable `new Array(n)` path.
      expect(() => compileV12('function main(){ let a = [1, 2, 3]; a[0] = 9; return a }')).toThrow(
        /array literals are immutable/,
      );
    });
  });

  describe('Statement-context stack hygiene', () => {
    it('drops a bare value-returning call result, but not when it is consumed', () => {
      // `noise(1);` as a statement returns a value that v12 must SDROP, or it leaks
      // on the stack. `noise` SETs no params, so the only SDROP source is the drop —
      // present when the result is discarded, absent when bound to a local.
      const dropped = compile('function noise(x){ return x } function main(){ noise(1); return 0 }', {
        target: 'v12',
      }).bytecode[0];
      const used = compile('function noise(x){ return x } function main(){ let y = noise(1); return y }', {
        target: 'v12',
      }).bytecode[0];

      expect(Array.from(dropped)).toContain(OPS_V12.SDROP);
      expect(Array.from(used)).not.toContain(OPS_V12.SDROP);
    });

    it('throws when main() is called (recursion into the entrypoint is unsupported)', () => {
      expect(() => compileV12('function main(){ return main() }')).toThrow(/main\(\) is not supported/);
    });
  });

  describe('Documented v12 boundaries', () => {
    it('break is not supported in v12', () => {
      expect(() => compileV12('function main(){ while (1) { break } }')).toThrow(/break.*v12/);
    });
  });

  // ── compile-time args: the no-param arg-prologue entry ──────────────────────
  // The runtime entry pushes only a stack-bottom sentinel; it does not marshal
  // main()'s params. So compile(src, { args }) synthesizes a PROLOGUE that pushes
  // the args (postfix) and falls through into main's inlined body, which reads its
  // params with the MAIN SDUP formula (no call-frame word). These tests pin the
  // structure + range; engine execution (returning the arg) is covered by the
  // dev-tools v12 EVM suite.
  describe('compile-time args (v12 arg-prologue)', () => {
    const v12 = (src: string, args: (bigint | bigint[])[]) =>
      Array.from(compile(src, { target: 'v12', args }).bytecode[0]);

    it('with no args, main is the entry — no prologue prepended (unchanged)', () => {
      // A trivial no-arg program is just `[push 1][MSTORE]` — the same bytes the
      // builder emits, with NO leading arg pushes.
      const noArgs = v12('function main(){ return 1 }', []);
      expect(noArgs).toEqual([OPS.BYTE_1, 1, OPS_V12.MSTORE]);
    });

    it('prepends an arg-push prologue and reads params with SDUP (no frame word)', () => {
      // `main(x){ return x }` with arg [42]: prologue pushes 42, then main reads it.
      // paramCount 1, paramIndex 0, depth 0 → MAIN formula SDUP1. Result MSTORE'd,
      // then STOP. (No CALL_FUNCTION — main is inlined behind the prologue.)
      const bc = v12('function main(x){ return x }', [42n]);
      expect(bc).toEqual([OPS.BYTE_1, 42, OPS_V12.SDUP1, OPS_V12.MSTORE, OPS.STOP]);
    });

    it('pushes multiple args forward (arg0 deepest) so SDUP picks the right param', () => {
      // `main(x,y){ return y }` [3,4]: prologue pushes 3 then 4 (y on top). y is
      // paramIndex 1 → MAIN formula SDUP1 (top). The deepest param (x) would be SDUP2.
      const bc = v12('function main(x,y){ return y }', [3n, 4n]);
      expect(bc).toEqual([OPS.BYTE_1, 3, OPS.BYTE_1, 4, OPS_V12.SDUP1, OPS_V12.MSTORE, OPS.STOP]);
    });

    it('builds a TUPLE arg on the stack (postfix: elements then TUPLE)', () => {
      // `main(t){ return t[1] }` [[5,9,2]]: prologue builds the tuple, then INDEX 1.
      // The arg push is the v12 tuple encoding (elements reversed by the builder,
      // then [TUPLE, 3]); leading bytes must be the tuple, last meaningful op INDEX.
      const bc = v12('function main(t){ return t[1] }', [[5n, 9n, 2n]]);
      // contains a TUPLE of 3 and an INDEX, and ends MSTORE + STOP.
      expect(bc).toContain(OPS.TUPLE);
      expect(bc[bc.indexOf(OPS.TUPLE) + 1]).toBe(3); // tuple length
      expect(bc).toContain(OPS.INDEX);
      expect(bc.slice(-2)).toEqual([OPS_V12.MSTORE, OPS.STOP]);
    });

    it('a deep multi-param main stays within the SDUP1-16 ceiling (no +1 frame word)', () => {
      // 9 params with a param read under several live locals would hit SDUP17 if main
      // were CALL_FUNCTION'd (the helper-frame +1 word) — past the EVM DUP16 limit, so
      // patchSdup would throw `REF position out of range: 17`. The fall-through prologue
      // (no frame word) keeps the deepest read at ≤16, so this must compile clean.
      const src =
        'function main(a,b,c,d,e,f,g,h,i){' +
        ' const l1=a+b; const l2=c+d; const l3=e+f; const l4=g+h; const l5=l1+l2; const l6=l3+l4;' +
        ' return a + i + l5 + l6; }';
      const args = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n];
      expect(() => compile(src, { target: 'v12', args })).not.toThrow();
    });
  });

  // ── main() frame-stride declaration (ALLOCATE prefix) ───────────────────────
  // The Huff runtime advances VALUES_BASE/HEAP_BASE on each CALL_FUNCTION by the
  // CALLER's declared slot count (recorded by ALLOCATE_VALUE/ALLOCATE_HEAP at the
  // function's entry), DEFAULTING TO 0 — a frame must ALLOCATE to stride. A HELPER
  // already emits its ALLOCATE prefix; main (inlined) did NOT, so a slot-using main
  // calling a helper left CUR_*_SLOTS at 0 and the callee's frame aliased main's
  // slots from base 0 (clobbering them). main must therefore ALSO emit
  // ALLOCATE_VALUE/ALLOCATE_HEAP declaring its own high-water slot count — emitted
  // UNCONDITIONALLY for every slot-using main (the default-0 contract: a missing
  // ALLOCATE is a latent aliasing bug, not a no-op). (Engine regression twin:
  // ../sauce engine-v12/test/V12-saucer/V12SaucerFrameBase.t.sol.)
  describe('main() frame-stride declaration', () => {
    // main using N declared `a*` value-slot locals plus `h` (the helper-call result)
    // = N+1 value slots when it calls a helper. Find the ALLOCATE_VALUE entry, assert
    // it declares the high-water and precedes the CALL_FUNCTION.
    const mainCallingHelper = (n: number): string => {
      const decls = Array.from({ length: n }, (_, i) => `let a${i}=${i + 1};`).join(' ');
      const reads = Array.from({ length: n }, (_, i) => `a${i}`).join('+');

      return `function id(x){ return x } function main(){ ${decls} let h=id(0); return ${reads}+h; }`;
    };

    it('main with >16 value slots + a helper call emits ALLOCATE_VALUE <high-water> at entry', () => {
      // 20 `a*` locals + `h` → main's value high-water is 21. Without the ALLOCATE the
      // runtime strides the id() call by the default 0, so id's frame aliases main's slots
      // from base 0 (clobbering them). The prefix must declare 21 and precede the call.
      const bc = compile(mainCallingHelper(20), { target: 'v12' }).bytecode[0];
      const allocIdx = bc.indexOf(OPS.ALLOCATE_VALUE);
      const callIdx = bc.indexOf(OPS.CALL_FUNCTION);
      expect(allocIdx).toBe(0); // main's ALLOCATE is the very first op
      expect(bc[allocIdx + 1]).toBe(21); // 20 a-locals + h = value-slot high-water
      expect(callIdx).toBeGreaterThan(allocIdx); // ALLOCATE precedes the call
    });

    it('a small main with a helper call still declares its frame', () => {
      // 10 `a*` + `h` = 11 value slots: the prefix declares 11 so the id() call strides
      // the callee past main's 11 slots (under default-0 it would otherwise alias them).
      const bc = compile(mainCallingHelper(10), { target: 'v12' }).bytecode[0];
      expect(bc[0]).toBe(OPS.ALLOCATE_VALUE);
      expect(bc[1]).toBe(11);
    });

    it('main with heap (new Array) locals emits ALLOCATE_HEAP <high-water> too', () => {
      // Heap slots have the SAME frame aliasing. A main with heap array locals must
      // declare its heap high-water so a helper call strides past them. 18 arrays = 18
      // heap slots; `h` is the scalar call result (value slot, separate pool).
      const decls = Array.from({ length: 18 }, (_, i) => `let g${i}=new Array(1);`).join(' ');
      const src = `function id(x){ return x } function main(){ ${decls} let h=id(0); return g17 }`;
      const bc = compile(src, { target: 'v12' }).bytecode[0];
      const heapIdx = bc.indexOf(OPS.ALLOCATE_HEAP);
      expect(heapIdx).toBeGreaterThanOrEqual(0);
      expect(bc[heapIdx + 1]).toBe(18); // 18 heap locals
    });

    it('the ALLOCATE prefix shifts SDUP/CALL positions consistently (compiles + patches clean)', () => {
      // With compile-time args (the arg-prologue path) the inlined main now also carries
      // the ALLOCATE prefix; main's recorded SDUP/CALL sentinels must be shifted past it
      // or patchSdup/patchCalls would target the wrong byte. A >16-slot param-main with a
      // helper call exercises both shifts — must compile without a REF/offset throw.
      const decls = Array.from({ length: 20 }, (_, i) => `let a${i}=p+${i};`).join(' ');
      const reads = Array.from({ length: 20 }, (_, i) => `a${i}`).join('+');
      const src = `function id(x){ return x } function main(p){ ${decls} let h=id(p); return ${reads}+h; }`;
      expect(() => compile(src, { target: 'v12', args: [5n] })).not.toThrow();
    });

    it('a leaf main (no helper call) STILL emits its ALLOCATE prefix (default-0 contract)', () => {
      // Under the default-0 engine, ALLOCATE is emitted for EVERY slot-using main,
      // unconditionally — even a call-free one. The prefix is harmless when no frame is
      // strided, and unconditional emission is the spec contract (a missing ALLOCATE is a
      // latent aliasing bug). A 20-local leaf main leads with ALLOCATE_VALUE 20 and has no
      // CALL_FUNCTION.
      const decls = Array.from({ length: 20 }, (_, i) => `let a${i}=${i + 1};`).join(' ');
      const reads = Array.from({ length: 20 }, (_, i) => `a${i}`).join('+');
      const bc = compile(`function main(){ ${decls} return ${reads}; }`, { target: 'v12' }).bytecode[0];
      expect(bc.indexOf(OPS.CALL_FUNCTION)).toBe(-1);
      expect(bc[0]).toBe(OPS.ALLOCATE_VALUE);
      expect(bc[1]).toBe(20);
    });

    it('a no-slot main (no locals) emits NO ALLOCATE prefix (nothing to declare)', () => {
      // ALLOCATE is gated on USING slots, not on calling. A main with zero locals has no
      // value/heap high-water, so allocatePrefix() is empty — `return 1` is just push+MSTORE.
      const bc = compile('function main(){ return 1 }', { target: 'v12' }).bytecode[0];
      expect(bc[0]).not.toBe(OPS.ALLOCATE_VALUE);
      expect(bc[0]).not.toBe(OPS.ALLOCATE_HEAP);
    });
  });
});
