import { Saucer, V12Saucer, OPS } from '../src/saucer/index.js';
import { CompilerContext } from '../src/context.js';
import type { SaucerLike } from '../src/saucer/index.js';

/**
 * PUSH / EMISSION ORDER — stated once (§1.7 compiler parity).
 *
 * The order in which each operand-bearing operation emits its operands is the load-bearing fact
 * that must agree between the two compilers. In compiler-rs it lives in ONE place —
 * `crates/sauce-core/src/push_order.rs`'s exhaustive `expression()` / `statement()` match, with
 * named tests (`a_calls_return_address_sits_beneath_every_argument`,
 * `a_set_index_evaluates_its_value_above_the_slot_address`, `a_shift_pushes_its_value_before_its_amount`,
 * …) pinning each rule. In THIS compiler the order is encoded implicitly, per method, across two
 * separate emitters:
 *
 *   - `src/saucer/saucer.ts`      — v1 PREFIX tree:   `[OP][a][b]`  (operand bytes AFTER the op)
 *   - `src/saucer/saucer-v12.ts`  — v12 POSTFIX stack: `[a][b][OP]`  (operands pushed, THEN the op)
 *
 * plus the shared encoders in `array.ts` / `tuple.ts`. There is no single driver the two emitters
 * consult (their operand emission is fused with sentinel / stackEffect bookkeeping that a shared
 * order table cannot be cleanly lifted out of without changing emitted bytes) — so this file is
 * that single statement instead: the `ORDER` table below is the one authoritative, diffable-against-
 * RS record of TS's push order, and every row is VERIFIED against what the real emitters actually
 * emit (the order is read back out of the finished bytecode, so the table can never silently drift
 * from emission — the same discipline `push_order.rs`'s
 * `every_nodes_stated_push_order_matches_what_codegen_emits` applies in RS).
 *
 * Each row records the emission order for BOTH targets as a permutation of the method's own
 * signature-parameter positions, and cross-references the corresponding `push_order.rs` rule with an
 * AGREE / DIVERGE verdict:
 *
 *   - v1 is a PREFIX tree, so its "order" is the byte order after the opcode; the v1 interpreter
 *     evaluates operands in that emitted order. It diverges from RS's stack push order wherever
 *     prefix-vs-postfix flips a non-commutative operand pair (RS/v12 push rhs-first so lhs lands on
 *     top; v1 emits lhs-first) — that is a MECHANISM divergence, not a semantic one.
 *   - v12 is a POSTFIX stack machine, the true analogue of RS's codegen, and AGREES with
 *     `push_order.rs` everywhere EXCEPT `setIndex`, where the release/beta v12 engine's SET_INDEX
 *     operand order is the reverse of the main-lineage engine RS targets (a genuine engine wire-
 *     format divergence — see CLAUDE.md's "two wire formats have diverged" note).
 */

// ── reading emission order back out of finished bytecode ──

// Each operand is a distinct 2-byte constant 0xE00k, whose encoded form is the unique 3-byte
// subsequence [BYTE_2, 0xE0, 0x0k]. Locating each in the emitted bytes, then sorting by first
// occurrence, recovers the exact order the emitter pushed/emitted them — target-agnostic, and
// robust to the MSTORE wraps and headers the emitters weave between operands.
const BYTE_2 = OPS.BYTE_2;
const roleValue = (i: number): bigint => BigInt(0xe001 + i);
const roleNeedle = (i: number): number[] => [BYTE_2, 0xe0, 0x01 + i];

const firstIndexOf = (hay: Uint8Array, needle: number[]): number => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }

    return i;
  }

  return -1;
};

/** The signature-parameter positions, in the order the built bytecode emits them. */
const emissionOrder = (bytes: Uint8Array, arity: number): number[] =>
  Array.from({ length: arity }, (_, i) => [i, firstIndexOf(bytes, roleNeedle(i))] as const)
    .filter(([, at]) => at >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([i]) => i);

// ── the table ──

interface Row {
  /** operation name (also the parity `it` label) */
  readonly name: string;
  /** how many signature-position operand markers `build` consumes */
  readonly arity: number;
  /** invoke the operation with one marker per signature position `m(i)` */
  readonly build: (s: SaucerLike, m: (i: number) => SaucerLike) => SaucerLike;
  /** emission order (signature-position permutation) for v1 prefix */
  readonly v1: number[];
  /** emission order (signature-position permutation) for v12 postfix */
  readonly v12: number[];
  /** the analogous `push_order.rs` rule, as its push-order permutation of the SAME positions */
  readonly rs: number[];
  /** verdict of v12 (RS's true analogue) vs the `push_order.rs` rule */
  readonly parity: 'AGREE' | 'DIVERGE';
  /** register any callees/params the op needs before it is built */
  readonly setup?: (ctx: CompilerContext) => void;
}

const ORDER: Row[] = [
  // ── arithmetic / bitwise binary ──
  {
    // push_order.rs: `Binary { .. } => ordered([(1, rhs), (0, lhs)], 0)` — rhs pushed first so lhs
    // lands on top. A COMMUTATIVE op's result is order-independent, so v12 keeps source order
    // (SWAPPED_OPS excludes it) rather than reversing — harmless, but a stated divergence from RS.
    name: 'add (commutative binary)',
    arity: 2,
    build: (s, m) => s.add(m(0), m(1)),
    v1: [0, 1],
    v12: [0, 1],
    rs: [1, 0],
    parity: 'DIVERGE',
  },
  {
    // push_order.rs `a_left_nested_chain_grows_one_per_level`: rhs-first push. v12's SWAPPED_OPS
    // emits [rhs][lhs][SUB] — AGREE. v1 prefix emits [SUB][lhs][rhs] (evaluated in that order).
    name: 'sub (non-commutative binary)',
    arity: 2,
    build: (s, m) => s.sub(m(0), m(1)),
    v1: [0, 1],
    v12: [1, 0],
    rs: [1, 0],
    parity: 'AGREE',
  },
  {
    // push_order.rs `a_shift_pushes_its_value_before_its_amount`:
    // `Shl | Shr => ordered([(0, lhs), (1, rhs)], 0)` — value first (the one binary exception).
    name: 'shl (shift)',
    arity: 2,
    build: (s, m) => s.shl(m(0), m(1)),
    v1: [0, 1],
    v12: [0, 1],
    rs: [0, 1],
    parity: 'AGREE',
  },
  {
    // push_order.rs `a_reversed_math_op_reports_source_positions` covers `math_operand_order`;
    // signExtend is SOURCE order there. v12 emits [value][fromByte][SIGN_EXTEND] (fromByte on top,
    // popped first) — AGREE. v1 emits it reversed ([SIGN_EXTEND][fromByte][value]) because the v1
    // Math.sol handler reads the byte index first.
    name: 'signExtend',
    arity: 2,
    build: (s, m) => s.signExtend(m(0), m(1)),
    v1: [1, 0],
    v12: [0, 1],
    rs: [0, 1],
    parity: 'AGREE',
  },

  // ── indexing / element store ──
  {
    // push_order.rs: `Index { .. } => ordered([(1, index), (0, object)], 0)` — index beneath,
    // container on top. Signature is index(arr, idx) → emits [idx][arr] on both targets.
    name: 'index',
    arity: 2,
    build: (s, m) => s.index(m(0), m(1)),
    v1: [1, 0],
    v12: [1, 0],
    rs: [1, 0],
    parity: 'AGREE',
  },
  {
    // push_order.rs `a_set_index_evaluates_its_value_above_the_slot_address`:
    // `SetIndex => at([(0,0,array),(1,1,index),(2,1,value)], 3)` — array pushed FIRST (deepest),
    // value LAST (on top). This engine's v12 SET_INDEX is the REVERSE: [value][index][array]
    // (value deepest, array on top) — a real engine wire-format divergence, NOT a codegen choice.
    // Signature is setIndex(array, index, value).
    name: 'setIndex',
    arity: 3,
    build: (s, m) => s.setIndex(m(0), m(1), m(2)),
    v1: [2, 1, 0],
    v12: [2, 1, 0],
    rs: [0, 1, 2],
    parity: 'DIVERGE',
  },

  // ── fixed-arity ternaries ──
  {
    name: 'mulDiv (ternary)',
    arity: 3,
    build: (s, m) => s.mulDiv(m(0), m(1), m(2)),
    v1: [0, 1, 2],
    v12: [0, 1, 2],
    rs: [0, 1, 2],
    parity: 'AGREE',
  },
  {
    // push_order.rs: `EcdsaVerify => ordered([(2, signer), (0, hash), (1, signature)], 0)` — signer
    // deepest, signature on top. Signature is ecdsaVerify(signer, hash, signature) → [0,1,2] emits
    // signer, hash, signature on both targets.
    name: 'ecdsaVerify',
    arity: 3,
    build: (s, m) => s.ecdsaVerify(m(0), m(1), m(2)),
    v1: [0, 1, 2],
    v12: [0, 1, 2],
    rs: [0, 1, 2],
    parity: 'AGREE',
  },
  {
    // push_order.rs generic `slice`: `at([(0, object), (1, start), (2, end)], 4)` — source order.
    name: 'slice',
    arity: 3,
    build: (s, m) => s.slice(m(0), m(1), m(2)),
    v1: [0, 1, 2],
    v12: [0, 1, 2],
    rs: [0, 1, 2],
    parity: 'AGREE',
  },

  // ── storage stores ──
  {
    // push_order.rs `an_evm_store_pushes_its_value_before_its_slot`:
    // `EvmSstore => ordered([(1, value), (0, slot)], 0)`. v12 emits [value][slot][SSTORE] — AGREE.
    // v1 prefix emits [SSTORE][slot][value].
    name: 'sstore',
    arity: 2,
    build: (s, m) => s.sstore(m(0), m(1)),
    v1: [0, 1],
    v12: [1, 0],
    rs: [1, 0],
    parity: 'AGREE',
  },
  {
    // No dedicated RS test, but TSTORE mirrors SSTORE: value before key on the postfix stack.
    name: 'tstore',
    arity: 2,
    build: (s, m) => s.tstore(m(0), m(1)),
    v1: [0, 1],
    v12: [1, 0],
    rs: [1, 0],
    parity: 'AGREE',
  },

  // ── calls ──
  {
    // push_order.rs: `EvmCall { value: Some } => ordered([(0, address), (1, value), (2, calldata)], 0)`
    // — source order. Signature externalCall(target, value, calldata).
    name: 'externalCall',
    arity: 3,
    build: (s, m) => s.externalCall(m(0), m(1), m(2)),
    v1: [0, 1, 2],
    v12: [0, 1, 2],
    rs: [0, 1, 2],
    parity: 'AGREE',
  },
  {
    // push_order.rs: `EvmCall { value: None } => ordered([(0, address), (1, calldata)], 0)`.
    name: 'staticCall',
    arity: 2,
    build: (s, m) => s.staticCall(m(0), m(1)),
    v1: [0, 1],
    v12: [0, 1],
    rs: [0, 1],
    parity: 'AGREE',
  },
  {
    // push_order.rs `a_calls_return_address_sits_beneath_every_argument`:
    // `Call { args, .. } => ordered(args.iter().enumerate(), 1)` — arguments in SOURCE order, each
    // one slot deeper because the return-address slot is reserved beneath them. Here every argument
    // emits in source order and the CALL_FUNCTION header (which establishes the callee frame /
    // return address) follows them all — the depth analogue of RS's `beneath: 1`.
    name: 'callFunction (args)',
    arity: 2,
    build: (s, m) => s.callFunction('callee', [m(0), m(1)]),
    v1: [0, 1],
    v12: [0, 1],
    rs: [0, 1],
    parity: 'AGREE',
    setup: (ctx) => {
      ctx.addFunc('callee');
      ctx.addFunc('main');
    },
  },

  // ── logs ──
  {
    // push_order.rs `a_log_pushes_its_data_beneath_its_topics_in_source_order`: data first, then
    // topics in source order. Modeled here as log(data, [topic1, topic2]).
    name: 'log (data + topics)',
    arity: 3,
    build: (s, m) => s.log(m(0), [m(1), m(2)]),
    v1: [0, 1, 2],
    v12: [0, 1, 2],
    rs: [0, 1, 2],
    parity: 'AGREE',
  },

  // ── aggregate literals ──
  {
    // push_order.rs: `Tuple(items) => reversed(items)` — elements pushed in REVERSE source order
    // (the engine op pops top-first). v12 `nary` reverses — AGREE. v1 inlines them in source order
    // in the packed TUPLE literal (a prefix-tree literal, not a stack push).
    name: 'tuple',
    arity: 3,
    build: (s, m) => s.tuple([m(0), m(1), m(2)]),
    v1: [0, 1, 2],
    v12: [2, 1, 0],
    rs: [2, 1, 0],
    parity: 'AGREE',
  },
  {
    // push_order.rs: `Concat(items) => reversed(items)`. v12 reverses (each scalar MSTORE-wrapped);
    // v1 inlines in source order.
    name: 'concat',
    arity: 3,
    build: (s, m) => s.concat([m(0), m(1), m(2)]),
    v1: [0, 1, 2],
    v12: [2, 1, 0],
    rs: [2, 1, 0],
    parity: 'AGREE',
  },
];

// ── verification: the stated order IS what the emitters emit ──

const v1Saucer = (setup?: (ctx: CompilerContext) => void): SaucerLike => {
  const ctx = new CompilerContext();
  setup?.(ctx);

  return new Saucer(ctx);
};

const v12Saucer = (setup?: (ctx: CompilerContext) => void): SaucerLike => {
  const ctx = new CompilerContext([], {}, 'v12');
  setup?.(ctx);

  return new V12Saucer(ctx);
};

const orderFor = (row: Row, make: (setup?: (ctx: CompilerContext) => void) => SaucerLike): number[] => {
  const s = make(row.setup);
  const result = row.build(s, (i) => s.int(roleValue(i)));

  return emissionOrder(result._bytes, row.arity);
};

describe('push order (§1.7) — v1 prefix emitter matches the stated table', () => {
  for (const row of ORDER) {
    it(`${row.name} emits operands in order [${row.v1}]`, () => {
      expect(orderFor(row, v1Saucer)).toEqual(row.v1);
    });
  }
});

describe('push order (§1.7) — v12 postfix emitter matches the stated table', () => {
  for (const row of ORDER) {
    it(`${row.name} emits operands in order [${row.v12}]`, () => {
      expect(orderFor(row, v12Saucer)).toEqual(row.v12);
    });
  }
});

describe('push order (§1.7) — v12 vs compiler-rs push_order.rs', () => {
  for (const row of ORDER) {
    const verdict = JSON.stringify(row.v12) === JSON.stringify(row.rs) ? 'AGREE' : 'DIVERGE';

    it(`${row.name} is ${row.parity} with push_order.rs (rs order [${row.rs}])`, () => {
      // The recorded `parity` verdict is the true relation between v12's order and RS's rule — a
      // guard against the table's prose drifting from its own numbers.
      expect(verdict).toBe(row.parity);
    });
  }
});

// ── the RS named cases, pinned directly (executable cross-reference) ──

describe('push order (§1.7) — compiler-rs named cases, pinned against TS', () => {
  it('a_calls_return_address_sits_beneath_every_argument: args stay in source order, frame header follows', () => {
    const s = v12Saucer((ctx) => {
      ctx.addFunc('callee');
      ctx.addFunc('main');
    });
    const call = s.callFunction('callee', [s.int(roleValue(0)), s.int(roleValue(1))]);
    // arguments in source order …
    expect(emissionOrder(call._bytes, 2)).toEqual([0, 1]);
    // … and the CALL_FUNCTION header (the return-address / frame reservation) comes AFTER them all,
    // the emission analogue of RS reserving the return slot beneath every argument.
    const argEnd = firstIndexOf(call._bytes, roleNeedle(1)) + roleNeedle(1).length;
    expect(call._bytes.indexOf(OPS.CALL_FUNCTION)).toBeGreaterThanOrEqual(argEnd);
  });

  it('a_set_index_evaluates_its_value_above_the_slot_address: RS puts value on top; v12 puts it deepest', () => {
    const s = v12Saucer();
    // setIndex(array, index, value)
    const r = s.setIndex(s.int(roleValue(0)), s.int(roleValue(1)), s.int(roleValue(2)));
    // v12 emits value(2) first (deepest), array(0) last (top) — the reverse of push_order.rs.
    expect(emissionOrder(r._bytes, 3)).toEqual([2, 1, 0]);
    expect(r._bytes.at(-1)).toBe(OPS.SET_INDEX);
  });

  it('a_shift_pushes_its_value_before_its_amount (v12)', () => {
    const s = v12Saucer();
    const shift = s.shl(s.int(roleValue(0)), s.int(roleValue(1)));
    const add = s.add(s.int(roleValue(0)), s.int(roleValue(1)));
    expect(emissionOrder(shift._bytes, 2)).toEqual([0, 1]); // value before amount
    expect(emissionOrder(add._bytes, 2)).toEqual([0, 1]); // commutative: source order kept
  });

  it('an_evm_store_pushes_its_value_before_its_slot (v12)', () => {
    const s = v12Saucer();
    const r = s.sstore(s.int(roleValue(0)), s.int(roleValue(1))); // sstore(slot, value)
    expect(emissionOrder(r._bytes, 2)).toEqual([1, 0]); // value first, slot second
    expect(r._bytes.at(-1)).toBe(OPS.SSTORE);
  });

  it('a_log_pushes_its_data_beneath_its_topics_in_source_order (v12)', () => {
    const s = v12Saucer();
    const r = s.log(s.int(roleValue(0)), [s.int(roleValue(1)), s.int(roleValue(2))]);
    expect(emissionOrder(r._bytes, 3)).toEqual([0, 1, 2]);
  });
});
