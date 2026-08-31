import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Array destructuring of multi-output contract-call returns:
//   const [price, tick] = pool.slot0();
// lowers to ONE external call whose RAW returndata lands in a hidden heap temp,
// with each bound element re-decoded at its store site — the decoded tuple is
// never stored in a variable (its descriptor does not survive a v1 round-trip).
// Shape B (`const s = pool.slot0()` + `s[k]`) keeps its store byte-identical,
// but the indexed reads — previously a guaranteed runtime
// SauceInvalidOperationArgs(INDEX) fault on v1 — are now compile errors that
// point at destructuring.
const poolAbi = [
  {
    type: 'function' as const,
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'getPair',
    inputs: [],
    outputs: [
      { name: 'a', type: 'uint256' },
      { name: 'b', type: 'uint256' },
    ],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'fee',
    inputs: [],
    outputs: [{ name: '', type: 'uint24' }],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'meta',
    inputs: [],
    outputs: [
      { name: 'n', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'list',
    inputs: [],
    outputs: [
      { name: 'n', type: 'uint256' },
      { name: 'xs', type: 'uint256[]' },
    ],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'wrap',
    inputs: [],
    outputs: [
      { name: 'nonce', type: 'uint256' },
      {
        name: 't',
        type: 'tuple',
        components: [
          { name: 'v', type: 'uint256' },
          { name: 'd', type: 'bytes' },
        ],
      },
    ],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'poke',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
  {
    type: 'function' as const,
    name: 'bump',
    inputs: [],
    outputs: [
      { name: 'counter', type: 'uint256' },
      { name: 'twice', type: 'uint256' },
    ],
    stateMutability: 'nonpayable' as const,
  },
  {
    type: 'function' as const,
    name: 'calc',
    inputs: [{ name: 'x', type: 'uint256' }],
    outputs: [
      { name: 'lo', type: 'uint256' },
      { name: 'hi', type: 'uint256' },
    ],
    stateMutability: 'view' as const,
  },
];

let tmpDir: string;
let baseDirs: string[];

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-destructuring-'));
  fs.writeFileSync(path.join(tmpDir, 'Pool.json'), JSON.stringify({ abi: poolAbi }));
  baseDirs = [tmpDir];
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const IMPORT = 'import { Pool } from "./Pool.json";';

const count = (bytecode: Uint8Array, op: number): number => bytecode.filter((b) => b === op).length;

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }

    return i;
  }

  return -1;
}

// Opcode-count assertions use raw byte counts, so a selector/operand byte equal
// to a counted opcode would skew them (the differential pairs embed the selector
// a DIFFERENT number of times, so collisions don't fully cancel). The ABIs here
// are chosen so no selector or operand byte collides with STATIC/CALL/ABI_DECODE/
// SLICE/CAST_BE, and the exact-emission hex pins below don't rely on counting.
describe('array destructuring — happy paths (v1)', () => {
  it('binds 2 of 7 outputs with a single external call', () => {
    const destructured = compile(
      `${IMPORT}
       function main() {
         const [price, tick] = Pool.at(1).slot0();
         return price + tick;
       }`,
      { baseDirs },
    ).bytecode[0];
    const doubleCall = compile(
      `${IMPORT}
       function main() {
         return Pool.at(1).slot0()[0] + Pool.at(1).slot0()[1];
       }`,
      { baseDirs },
    ).bytecode[0];

    // one STATIC instead of two
    expect(count(doubleCall, OPS.STATIC) - count(destructured, OPS.STATIC)).toBe(1);
    // raw returndata parked in a heap temp
    expect(count(destructured, OPS.WRITE_HEAP)).toBeGreaterThanOrEqual(1);
    // one re-decode per bound element
    expect(count(destructured, OPS.ABI_DECODE)).toBe(2);
  });

  it('binds all 7 outputs', () => {
    const { bytecode } = compile(
      `${IMPORT}
       function main() {
         const [a, b, c, d, e, f, g] = Pool.at(1).slot0();
         return a + b + c + d + e + f + g;
       }`,
      { baseDirs },
    );

    expect(count(bytecode[0], OPS.ABI_DECODE)).toBe(7);
  });

  it('supports holes and partial bindings', () => {
    const { bytecode } = compile(
      `${IMPORT}
       function main() {
         const [, tick] = Pool.at(1).slot0();
         return tick;
       }`,
      { baseDirs },
    );

    expect(count(bytecode[0], OPS.ABI_DECODE)).toBe(1);
  });

  it('destructures a single-output method', () => {
    expect(() =>
      compile(
        `${IMPORT}
         function main() {
           const [f] = Pool.at(1).fee();
           return f;
         }`,
        { baseDirs },
      ),
    ).not.toThrow();
  });

  it('evaluates a holes-only pattern for its side effects', () => {
    const { bytecode } = compile(
      `${IMPORT}
       function main() {
         const [,] = Pool.at(1).bump();
         return 0;
       }`,
      { baseDirs },
    );

    // nonpayable → CALL; emitted despite zero bindings
    expect(count(bytecode[0], OPS.CALL)).toBeGreaterThanOrEqual(1);
    expect(count(bytecode[0], OPS.ABI_DECODE)).toBe(0);
  });

  it('works with a variable-bound contract', () => {
    expect(() =>
      compile(
        `${IMPORT}
         function main() {
           const pool = Pool.at(1);
           const [a, b] = pool.getPair();
           return a + b;
         }`,
        { baseDirs },
      ),
    ).not.toThrow();
  });

  it('works with .view() bindings', () => {
    expect(() =>
      compile(
        `${IMPORT}
         function main() {
           const [a, b] = Pool.view(1).getPair();
           return a + b;
         }`,
        { baseDirs },
      ),
    ).not.toThrow();
  });

  it('allows a hole over a nested-tuple output', () => {
    expect(() =>
      compile(
        `${IMPORT}
         function main() {
           const [nonce] = Pool.at(1).wrap();
           return nonce;
         }`,
        { baseDirs },
      ),
    ).not.toThrow();
  });

  it('binds dynamic components (bytes, arrays) as heap values', () => {
    expect(() =>
      compile(
        `${IMPORT}
         function main() {
           const [n, data] = Pool.at(1).meta();
           const [m, xs] = Pool.at(1).list();
           return n + data.length + m + xs[0] + xs.length;
         }`,
        { baseDirs },
      ),
    ).not.toThrow();
  });

  it('compiles for v12 with the same one-call shape (zero-decode fast path)', () => {
    const destructured = compile(
      `${IMPORT}
       function main() {
         const [price, tick] = Pool.at(1).slot0();
         return price + tick;
       }`,
      { baseDirs, target: 'v12' },
    ).bytecode[0];
    const doubleCall = compile(
      `${IMPORT}
       function main() {
         return Pool.at(1).slot0()[0] + Pool.at(1).slot0()[1];
       }`,
      { baseDirs, target: 'v12' },
    ).bytecode[0];

    expect(count(doubleCall, OPS.STATIC) - count(destructured, OPS.STATIC)).toBe(1);
    // elementary-static components skip the decode entirely on v12
    expect(count(destructured, OPS.ABI_DECODE)).toBe(0);
    expect(count(destructured, OPS.SLICE)).toBe(2);
    expect(count(destructured, OPS.CAST_BE)).toBe(2);
  });

  it('keeps a helper reachable when treeshaking (init args are walked)', () => {
    expect(() =>
      compile(
        `${IMPORT}
         function helper() { return 3; }
         function main() {
           const [lo, hi] = Pool.at(1).calc(helper());
           return lo + hi;
         }`,
        { baseDirs, treeshake: true },
      ),
    ).not.toThrow();
  });
});

describe('array destructuring — rejected shapes', () => {
  const compileMain = (body: string, target?: 'v1' | 'v12' | 'svm') =>
    compile(`${IMPORT} function main() { ${body} }`, { baseDirs, target });

  it('rejects a non-call initializer', () => {
    expect(() => compileMain('const [a, b] = [1, 2]; return a;')).toThrow(
      /array destructuring requires a contract method call initializer/,
    );
  });

  it('rejects an identifier initializer', () => {
    expect(() => compileMain('const x = 1; const [a] = x; return a;')).toThrow(
      /array destructuring requires a contract method call initializer/,
    );
  });

  it('rejects a user-function initializer', () => {
    expect(() =>
      compile(`${IMPORT} function two() { return 2; } function main() { const [a] = two(); return a; }`, {
        baseDirs,
      }),
    ).toThrow(/array destructuring requires a contract method call initializer/);
  });

  it('rejects a .catch() chain initializer', () => {
    expect(() => compileMain('const [a, b] = Pool.at(1).getPair().catch(() => { return 0; }); return a;')).toThrow(
      /cannot destructure a \.catch\(\) chain/,
    );
  });

  it('rejects a zero-output method', () => {
    expect(() => compileMain('const [a] = Pool.at(1).poke(); return a;')).toThrow(
      /cannot destructure Pool\.poke\(\): it returns no outputs/,
    );
  });

  it('rejects more elements than outputs', () => {
    expect(() => compileMain('const [a, b, c] = Pool.at(1).getPair(); return a;')).toThrow(
      /cannot destructure 2 output\(s\) of Pool\.getPair\(\) into 3 element\(s\)/,
    );
  });

  it('rejects rest elements', () => {
    expect(() => compileMain('const [a, ...rest] = Pool.at(1).slot0(); return a;')).toThrow(
      /not implemented: rest element in array destructuring/,
    );
  });

  it('rejects nested patterns', () => {
    expect(() => compileMain('const [a, [b]] = Pool.at(1).getPair(); return a;')).toThrow(
      /not implemented: ArrayPattern in array destructuring/,
    );
  });

  it('rejects binding a nested-tuple output', () => {
    expect(() => compileMain('const [nonce, t] = Pool.at(1).wrap(); return nonce;')).toThrow(
      /a nested tuple cannot be stored in a variable/,
    );
  });

  it('reports an unknown method by name', () => {
    expect(() => compileMain('const [a] = Pool.at(1).nope(); return a;')).toThrow(
      /Unknown method "nope" on contract "Pool"/,
    );
  });

  it('rejects duplicate names in the pattern (acorn parse error)', () => {
    expect(() => compileMain('const [a, a] = Pool.at(1).getPair(); return a;')).toThrow(/already been declared/);
  });

  it('still rejects object patterns', () => {
    expect(() => compileMain('const { a } = Pool.at(1).getPair(); return a;')).toThrow(
      /not implemented: ObjectPattern/,
    );
  });

  it('errors cleanly on target svm (destructuring-specific message)', () => {
    expect(() => compileMain('const [a, b] = Pool.at(1).getPair(); return a;', 'svm')).toThrow(
      /array destructuring is not supported on target 'svm'/,
    );
  });

  it('reports an unknown contract by name', () => {
    expect(() => compileMain('const [a] = Nope.at(1).thing(); return a;')).toThrow(/Unknown contract: Nope/);
  });

  it('rejects rebinding an existing variable of a mismatched kind', () => {
    // no block scope for if-bodies: the inner name resolves to the outer scalar
    // variable, whose slot would strip the bytes component's heap descriptor
    expect(() =>
      compileMain(
        'let data = 0; if (ctx.msgValue() > 0) { const [n, data] = Pool.at(1).meta(); return n + data.length; } return data;',
      ),
    ).toThrow(/cannot destructure output 1 \('data'\).*existing scalar variable 'data'/);
  });

  it('allows rebinding an existing variable of the matching kind (plain-const semantics)', () => {
    expect(() =>
      compileMain('let f = 0; if (ctx.msgValue() > 0) { const [f] = Pool.at(1).fee(); return f; } return f;'),
    ).not.toThrow();
  });
});

// v12 zero-decode fast path: elementary-static components are extracted from the
// raw returndata with CAST_BE(SLICE(temp, k*32 + (32-N), N)) — pointer-arithmetic
// slice + right-aligned cast, bit-identical to the engine's ABI_DECODE ad_scalar
// mask (including negative signed intN) with zero per-element re-decode. Dynamic
// components and any statement whose output tuple contains a nested 'tuple'
// (inlined static tuples occupy multiple head words → k*32 would be wrong) keep
// the portable decode lowering, as do v1 and svm entirely.
describe('v12 zero-decode fast path (SLICE + CAST_BE)', () => {
  const compileTarget = (body: string, target: 'v1' | 'v12') =>
    compile(`${IMPORT} function main() { ${body} }`, { baseDirs, target }).bytecode[0];

  it('extracts mixed-width statics (uint160, uint8, bool) with correct offsets', () => {
    const bc = compileTarget('const [a, , , , , f, g] = Pool.at(1).slot0(); return a + f + g;', 'v12');

    expect(count(bc, OPS.ABI_DECODE)).toBe(0);
    expect(count(bc, OPS.SLICE)).toBe(3);
    expect(count(bc, OPS.CAST_BE)).toBe(3);
    // offset operands: uint160@0 → 12, uint8@5 → 191, bool@6 → 223
    for (const offset of [12, 191, 223]) {
      expect(indexOfBytes(bc, new Uint8Array([OPS.BYTE_1, offset]))).toBeGreaterThanOrEqual(0);
    }
  });

  it('pins the int24 offset/width math (head word 1, low 3 bytes)', () => {
    const bc = compileTarget('const [, tick] = Pool.at(1).slot0(); return tick;', 'v12');

    expect(count(bc, OPS.ABI_DECODE)).toBe(0);
    expect(count(bc, OPS.SLICE)).toBe(1);
    // offset = 1*32 + (32-3) = 61, width = 3
    expect(indexOfBytes(bc, new Uint8Array([OPS.BYTE_1, 61]))).toBeGreaterThanOrEqual(0);
    expect(indexOfBytes(bc, new Uint8Array([OPS.BYTE_1, 3]))).toBeGreaterThanOrEqual(0);
  });

  // Presence-only probes and opcode counts are order-insensitive — a mutant that
  // swaps the SLICE offset/length operands passes them (mutation-verified in
  // review). These full-program pins fix the exact emission, operand ORDER
  // included: per binding READ_HEAP temp · BYTE_1 offset · BYTE_1 width · SLICE
  // · CAST_BE · WRITE_VALUE slot.
  it('pins the exact fast-path emission bytes (hole + int24)', () => {
    const bc = compileTarget('const [, tick] = Pool.at(1).slot0(); return tick;', 'v12');

    // ALLOCATE_VALUE 1 · ALLOCATE_HEAP 1 · [int(1) selector(3850c7bd) STATIC] →
    // WRITE_HEAP 0 · READ_HEAP 0 · offset 61 · width 3 · SLICE · CAST_BE →
    // WRITE_VALUE 0 · READ_VALUE 0 · return
    expect(Buffer.from(bc).toString('hex')).toBe('c001c201010190043850c7bda3c3009800013d01039554c1005000f2');
  });

  it('pins the exact fast-path emission bytes (uint160 + int24)', () => {
    const bc = compileTarget('const [big, tick] = Pool.at(1).slot0(); return tick;', 'v12');

    // as above, two bindings: offset 12/width 20 (uint160), offset 61/width 3
    expect(Buffer.from(bc).toString('hex')).toBe(
      'c002c201010190043850c7bda3c3009800010c01149554c1009800013d01039554c1015001f2',
    );
  });

  it('mixes fast statics with decoded dynamic components', () => {
    const bc = compileTarget('const [n, data] = Pool.at(1).meta(); return n + data.length;', 'v12');

    expect(count(bc, OPS.ABI_DECODE)).toBe(1); // bytes component still decodes
    expect(count(bc, OPS.SLICE)).toBe(1); // uint256 component sliced
    expect(count(bc, OPS.CAST_BE)).toBe(1);
  });

  it('keeps the decode lowering for array components', () => {
    const bc = compileTarget('const [n, xs] = Pool.at(1).list(); return n + xs[0];', 'v12');

    expect(count(bc, OPS.ABI_DECODE)).toBe(1);
    expect(count(bc, OPS.SLICE)).toBe(1);
  });

  it('disables the fast path entirely when any output is a nested tuple (hole over it)', () => {
    const bc = compileTarget('const [nonce] = Pool.at(1).wrap(); return nonce;', 'v12');

    // an inlined static tuple would shift head words — every binding falls back
    expect(count(bc, OPS.ABI_DECODE)).toBe(1);
    expect(count(bc, OPS.SLICE)).toBe(0);
    expect(count(bc, OPS.CAST_BE)).toBe(0);
  });

  it('leaves the v1 lowering untouched (per-element decode, no slice/cast)', () => {
    const bc = compileTarget('const [price, tick] = Pool.at(1).slot0(); return price + tick;', 'v1');

    expect(count(bc, OPS.ABI_DECODE)).toBe(2);
    expect(count(bc, OPS.SLICE)).toBe(0);
    expect(count(bc, OPS.CAST_BE)).toBe(0);
  });
});

// Shape B (`const s = pool.slot0()` + `s[k]`) previously compiled on v1 and then
// faulted at runtime with SauceInvalidOperationArgs(INDEX) — the decoded tuple's
// descriptor does not survive the variable round-trip. The STORE (and bare reads
// of the variable — shipping protocol functions like arrakis/pendle `return` the
// stored result directly) keep compiling byte-identically; only the reads that
// were guaranteed runtime faults become compile errors pointing at destructuring.
describe('shape B — multi-output call result stored in a variable (v1 guard)', () => {
  const compileMain = (body: string, target?: 'v1' | 'v12') =>
    compile(`${IMPORT} function main() { ${body} }`, { baseDirs, target });

  it('rejects an indexed read (was a guaranteed runtime INDEX fault)', () => {
    expect(() => compileMain('const s = Pool.at(1).slot0(); return s[0] + s[6];')).toThrow(
      /cannot index 's'.*destructure the call instead/,
    );
  });

  it('rejects a computed indexed read', () => {
    expect(() =>
      compileMain(
        'const s = Pool.at(1).slot0(); let sum = 0; for (let i = 0; i < 3; i++) { sum += s[i]; } return sum;',
      ),
    ).toThrow(/cannot index 's'/);
  });

  it('rejects element assignment', () => {
    expect(() => compileMain('const s = Pool.at(1).slot0(); s[0] = 1; return 0;')).toThrow(
      /cannot assign to a component of 's'/,
    );
  });

  it('rejects compound element assignment', () => {
    expect(() => compileMain('const s = Pool.at(1).slot0(); s[0] += 1; return 0;')).toThrow(
      /cannot assign to a component of 's'/,
    );
  });

  it('keeps bare reads compiling (arrakis/pendle `return result` shape)', () => {
    expect(() => compileMain('const s = Pool.at(1).getPair(); return s;')).not.toThrow();
  });

  it('keeps the variable-bound protocol shape compiling', () => {
    expect(() => compileMain('const pool = Pool.at(1); const result = pool.getPair(); return result;')).not.toThrow();
  });

  // Before the "single dynamic ABI output" / ternary-branch-promotion fixes (see
  // CLAUDE.md's "Same-file user-function return-kind inference" note), this compiled
  // cleanly — but `s` stayed a SCALAR slot (the multi-output tag mechanism doesn't
  // promote kind), so storing the array literal's dynamic/heap value into it was a
  // SILENT, undetected instance of the identical descriptor-drop hazard this whole
  // bug family is about: confirmed via real EVM execution that the analogous
  // `let s = 5n; s = [10n, 20n, 30n]; return s[0];` reverts
  // SauceInvalidOperationArgs(0x97) (INDEX) on v1 today. `rejectV1ScalarToDynamicReassignment`
  // (statement.ts) now catches this at compile time instead — a strict improvement
  // (a clear error beats a silent runtime revert), so the "clears the tag" behavior
  // this test used to pin is superseded by an even earlier, louder rejection.
  it('rejects reassigning an array literal into an already-scalar variable (was a silent runtime INDEX fault)', () => {
    expect(() => compileMain('let s = Pool.at(1).slot0(); s = [1, 2, 3]; return s[0];')).toThrow(
      /cannot assign a dynamic value to 's'/,
    );
  });

  it('does NOT tag a dynamic-kind destination (heap round-trip preserves the tuple on v1)', () => {
    // `s` was declared with an array literal → dynamic/heap slot; the
    // reassignment stores the decoded tuple via WRITE_HEAP, which the v1 engine
    // round-trips intact (runtime-verified — same mechanism as new Array(n)).
    expect(() => compileMain('let s = [0, 0]; s = Pool.at(1).slot0(); return s[1];')).not.toThrow();
    expect(() => compileMain('let s = new Array(2); s = Pool.at(1).slot0(); return s[1];')).not.toThrow();
  });

  it('re-tags on reassignment of a SCALAR variable with a multi-output call', () => {
    expect(() => compileMain('let s = 0; s = Pool.at(1).slot0(); return s[0];')).toThrow(/cannot index 's'/);
  });

  // Same latent hazard as the array-literal case just above, via the ternary path:
  // `processTernaryStore` promotes to 'dynamic' storage when EITHER branch resolves
  // dynamic (both do here — two array literals), and `rejectV1ScalarToDynamicReassignment`
  // then rejects the reassignment of an already-scalar `s` — a compile-time catch of
  // what was previously a silent runtime INDEX fault, not a "keeps compiling" case.
  it('rejects a ternary reassignment whose branches are dynamic into an already-scalar variable', () => {
    expect(() =>
      compileMain('let s = Pool.at(1).slot0(); s = ctx.msgValue() > 0 ? [1, 2] : [3, 4]; return s[0];'),
    ).toThrow(/cannot assign a dynamic value to 's'/);
  });

  it('update-expression reassignment clears a stale tag', () => {
    expect(() => compileMain('let i = 1; let s = Pool.at(1).slot0(); s = i++; return s + i;')).not.toThrow();
  });

  it('tags a ternary whose BOTH branches are multi-output calls (guaranteed fault)', () => {
    expect(() =>
      compileMain('const s = ctx.msgValue() > 0 ? Pool.at(1).slot0() : Pool.at(2).slot0(); return s[0];'),
    ).toThrow(/cannot index 's'/);
  });

  it('leaves a single-multi-output-branch ternary untagged (documented hole — other path may be valid)', () => {
    expect(() => compileMain('const s = ctx.msgValue() > 0 ? Pool.at(1).slot0() : [1, 2]; return s[0];')).not.toThrow();
  });

  it('propagates the tag through aliasing (const t = s)', () => {
    expect(() => compileMain('const s = Pool.at(1).slot0(); const t = s; return t[1];')).toThrow(/cannot index 't'/);
  });

  it('compiles a v12 stack param read AFTER a destructuring statement (stack neutrality)', () => {
    // a stack-effect leak in the destructuring statement would corrupt the
    // param's SDUP depth patch and throw at assembly
    expect(() =>
      compile(
        `${IMPORT} function helper(p) { const [a, b] = Pool.at(1).getPair(); return p + a + b; } function main() { return helper(7); }`,
        {
          baseDirs,
          target: 'v12',
        },
      ),
    ).not.toThrow();
  });

  it('leaves single-output call stores untouched (indexing stays legal)', () => {
    expect(() => compileMain('const f = Pool.at(1).fee(); return f;')).not.toThrow();
  });

  it('leaves inline chained indexing untouched (shape A)', () => {
    expect(() => compileMain('return Pool.at(1).slot0()[0] + Pool.at(1).wrap()[1][0];')).not.toThrow();
  });

  it('keeps the v12 lowering fully unchanged (stores AND indexed reads work)', () => {
    const v12 = compileMain('const s = Pool.at(1).slot0(); return s[0] + s[6];', 'v12').bytecode[0];

    // v12 decodes ONCE at the call site — the stored tuple survives its
    // round-trip there, so no guard applies.
    expect(count(v12, OPS.ABI_DECODE)).toBe(1);
  });
});

// ── ADVERSARIAL-AUDIT FINDING (this branch): `processTernaryStore`'s `branchKind`
// computation had NO notion of a direct external contract call with a single dynamic
// ABI output ──
//
// `singleDynamicAbiOutputKind` (statement.ts, a few lines above `processTernaryStore`)
// closes this exact gap for the PLAIN (non-ternary) store path — `storeExpression`'s
// default branch tries it BEFORE falling back to `inferKindWithContext` — but
// `processTernaryStore`'s own `branchKind` computation never consulted it, only
// `inferKindWithContext` directly for each branch. `inferKindWithContext` has no
// notion of a direct contract-method call at all (only a same-file user function's
// analyzed return kind, via its own CallExpression case), so a ternary branch that is
// itself a direct `Contract.at(addr).method()` call with a single dynamic ABI output
// was always classified 'scalar' by `branchKind` — even though the sibling plain-store
// path (`let x = Contract.at(addr).method();`, no ternary) already correctly infers
// 'dynamic' for the IDENTICAL call shape via `singleDynamicAbiOutputKind`.
describe('ternary branchKind: a direct dynamic-ABI-output contract call (FINDING fix)', () => {
  const listAbi = [
    {
      type: 'function' as const,
      name: 'list2',
      inputs: [],
      outputs: [{ name: 'xs', type: 'uint256[]' }],
      stateMutability: 'view' as const,
    },
  ];

  let listTmpDir: string;
  let listBaseDirs: string[];

  beforeAll(() => {
    listTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-ternary-dynamic-call-'));
    fs.writeFileSync(path.join(listTmpDir, 'List2.json'), JSON.stringify({ abi: listAbi }));
    listBaseDirs = [listTmpDir];
  });

  afterAll(() => {
    fs.rmSync(listTmpDir, { recursive: true, force: true });
  });

  const LIST_IMPORT = 'import { List2 } from "./List2.json";';

  it('infers dynamic (HEAP) storage for a ternary whose CONSEQUENT is a direct dynamic-output contract call', () => {
    const result = compile(
      `${LIST_IMPORT}
       function main(cond) {
         let x = cond === 1n ? List2.at(1).list2() : 0n;
         return x[0];
       }`,
      { baseDirs: listBaseDirs },
    );

    // Fixed: `x` is dynamic (HEAP) storage — no WRITE_VALUE/READ_VALUE for it at all.
    expect(result.bytecode[0]).not.toContain(OPS.WRITE_VALUE);
    expect(Array.from(result.bytecode[0])).toEqual(
      expect.arrayContaining([OPS.ALLOCATE_HEAP, OPS.WRITE_HEAP, OPS.READ_HEAP]),
    );
  });

  it('infers dynamic (HEAP) storage for a ternary whose ALTERNATE is a direct dynamic-output contract call', () => {
    const result = compile(
      `${LIST_IMPORT}
       function main(cond) {
         let x = cond === 1n ? 0n : List2.at(1).list2();
         return x[0];
       }`,
      { baseDirs: listBaseDirs },
    );

    expect(result.bytecode[0]).not.toContain(OPS.WRITE_VALUE);
    expect(Array.from(result.bytecode[0])).toEqual(
      expect.arrayContaining([OPS.ALLOCATE_HEAP, OPS.WRITE_HEAP, OPS.READ_HEAP]),
    );
  });

  it('negative control: BOTH branches scalar stays scalar, unaffected', () => {
    const result = compile(
      `${LIST_IMPORT}
       function main(cond) {
         let x = cond === 1n ? 1n : 2n;
         return x;
       }`,
      { baseDirs: listBaseDirs },
    );

    expect(result.bytecode[0]).not.toContain(OPS.ALLOCATE_HEAP);
  });
});
