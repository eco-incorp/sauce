import { V12Saucer, OPS, OPS_V12 } from '../src/saucer/index.js';
import { CompilerContext } from '../src/context.js';

const ctx = () => new CompilerContext([], {}, 'v12');
const S = () => new V12Saucer(ctx());
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
/** A V12 context with the given names declared as stack params (in order). */
const paramCtx = (...names: string[]): CompilerContext => {
  const c = ctx();
  for (const n of names) {
    c.setVar(n, 'scalar', undefined, undefined, true);
    c.pushStack(n);
  }

  return c;
};

describe('V12Saucer — postfix emission', () => {
  it('emits binary ops postfix: [a][b][OP]', () => {
    const s = S();
    const r = s.add(s.int(1n), s.int(2n));
    // [BYTE_1,1][BYTE_1,2][ADD=0x21]
    expect(hex(r._bytes)).toBe('0101010221');
  });

  it('emits a uint constant as the minimal BYTE_N form', () => {
    expect(hex(S().int(5n)._bytes)).toBe('0105');
    expect(hex(S().int(256n)._bytes)).toBe('020100');
  });

  it('emits a negative constant postfix: literal first, NEG last', () => {
    // encodeInt's v1 prefix form ([NEG][BYTE_N][…]) is reordered — the postfix
    // engines pop NEG's operand off the stack. [BYTE_1,5][NEG=0x29].
    expect(hex(S().int(-5n)._bytes)).toBe('010529');
    expect(hex(S().int(-256n)._bytes)).toBe('02010029');
  });

  it('context ops are nullary single opcodes', () => {
    expect(Array.from(S().msgSender()._bytes)).toEqual([OPS.MSG_SENDER]);
    expect(Array.from(S().blockTimestamp()._bytes)).toEqual([OPS.TIMESTAMP]);
  });
});

describe('V12Saucer — operand swapping (non-commutative)', () => {
  // Methods that take two operands and return a builder — typed so the table-driven
  // call below needs no `as any` (every entry has the same (l, r) => V12Saucer shape).
  type BinaryMethod =
    | 'add'
    | 'sub'
    | 'mul'
    | 'div'
    | 'mod'
    | 'exp'
    | 'eq'
    | 'neq'
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte'
    | 'and'
    | 'or'
    | 'bitAnd';

  const swapped: [BinaryMethod, number][] = [
    ['sub', OPS.SUB],
    ['div', OPS.DIV],
    ['mod', OPS.MOD],
    ['exp', OPS.EXP],
    ['gt', OPS.BOOL_GT],
    ['lt', OPS.BOOL_LT],
    ['gte', OPS.BOOL_GTE],
    ['lte', OPS.BOOL_LTE],
  ];

  for (const [method, op] of swapped) {
    it(`${method} swaps operands → [b][a][OP]`, () => {
      const s = S();
      const r = s[method](s.int(5n), s.int(3n));
      // 5 = 0105, 3 = 0103; swapped → [3][5][OP]
      expect(hex(r._bytes)).toBe('01030105' + op.toString(16).padStart(2, '0'));
    });
  }

  const commutative: [BinaryMethod, number][] = [
    ['add', OPS.ADD],
    ['mul', OPS.MUL],
    ['eq', OPS.BOOL_EQ],
    ['neq', OPS.BOOL_NEQ],
    ['and', OPS.BOOL_AND],
    ['or', OPS.BOOL_OR],
    ['bitAnd', OPS.AND],
  ];

  for (const [method, op] of commutative) {
    it(`${method} keeps operand order → [a][b][OP]`, () => {
      const s = S();
      const r = s[method](s.int(5n), s.int(3n));
      expect(hex(r._bytes)).toBe('01050103' + op.toString(16).padStart(2, '0'));
    });
  }
});

describe('V12Saucer — isDynamic tracking', () => {
  it('scalars/context ops are non-dynamic', () => {
    expect(S().int(1n).isDynamic).toBe(false);
    expect(S().msgSender().isDynamic).toBe(false);
    expect(S().add(S().int(1n), S().int(2n)).isDynamic).toBe(false);
    expect(S().sload(S().int(0n)).isDynamic).toBe(false);
    expect(S().keccak256(S().bytes(new Uint8Array([1]))).isDynamic).toBe(false);
  });

  it('dynamic-producing ops are dynamic', () => {
    expect(S().bytes(new Uint8Array([1, 2])).isDynamic).toBe(true);
    expect(S().string('hi').isDynamic).toBe(true);
    expect(S().msgData().isDynamic).toBe(true);
    expect(S().tuple([S().int(1n)]).isDynamic).toBe(true);
    expect(S().concat([S().bytes(new Uint8Array([1]))]).isDynamic).toBe(true);
    expect(S().abiEncode(S().tuple([S().int(1n)])).isDynamic).toBe(true);
  });
});

describe('V12Saucer — MSTORE descriptor wrapping', () => {
  it('keccak wraps a scalar operand with MSTORE', () => {
    const s = S();
    const r = s.keccak256(s.int(1n));
    // [BYTE_1,1][MSTORE][KECCAK256]
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 1, OPS_V12.MSTORE, OPS.KECCAK256]);
  });

  it('keccak skips MSTORE for an already-dynamic operand', () => {
    const s = S();
    const r = s.keccak256(s.bytes(new Uint8Array([0xaa])));
    expect(Array.from(r._bytes)).toEqual([OPS.BYTES, 1, 0xaa, OPS.KECCAK256]);
  });

  it('slice wraps a scalar data operand with MSTORE', () => {
    const s = S();
    const r = s.slice(s.int(1n), s.int(0n), s.int(2n));
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 1, OPS_V12.MSTORE, OPS.BYTE_1, 0, OPS.BYTE_1, 2, OPS.SLICE]);
  });

  it('build() appends MSTORE for a scalar main result', () => {
    const r = S().int(42n);
    expect(Array.from(r.build())).toEqual([OPS.BYTE_1, 42, OPS_V12.MSTORE]);
  });

  it('build() leaves a dynamic main result untouched', () => {
    const r = S().bytes(new Uint8Array([0xaa]));
    expect(Array.from(r.build())).toEqual([OPS.BYTES, 1, 0xaa]);
  });
});

describe('V12Saucer — stackEffect accumulation', () => {
  it('a constant pushes one', () => {
    expect(S().int(1n).stackEffect).toBe(1);
  });
  it('a binary op nets +1 (two operands consumed, one result)', () => {
    expect(S().add(S().int(1n), S().int(2n)).stackEffect).toBe(1);
  });
  it('a nested expression still nets +1', () => {
    const s = S();
    expect(s.mul(s.add(s.int(1n), s.int(2n)), s.sub(s.int(5n), s.int(3n))).stackEffect).toBe(1);
  });
  it('sstore nets 0 (value+slot consumed)', () => {
    expect(S().sstore(S().int(0n), S().int(1n)).stackEffect).toBe(0);
  });
});

describe('V12Saucer — storage postfix order', () => {
  it('sstore emits [value][slot][SSTORE]', () => {
    const s = S();
    const r = s.sstore(s.int(0n), s.int(42n)); // slot 0, value 42
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 42, OPS.BYTE_1, 0, OPS.SSTORE]);
  });
  it('tstore emits [value][key][TSTORE]', () => {
    const s = S();
    const r = s.tstore(s.int(1n), s.int(99n)); // key 1, value 99
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 99, OPS.BYTE_1, 1, OPS.TSTORE]);
  });
});

describe('V12Saucer — tuple/array reverse + index', () => {
  it('tuple emits elements in reverse then [TUPLE][count]', () => {
    const s = S();
    const r = s.tuple([s.int(1n), s.int(2n), s.int(3n)]);
    // reverse: 3,2,1 then TUPLE,3
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 3, OPS.BYTE_1, 2, OPS.BYTE_1, 1, OPS.TUPLE, 3]);
  });

  it('index emits [idx][arr][INDEX]', () => {
    const s = S();
    const arr = s.tuple([s.int(7n)]);
    const r = s.index(arr, s.int(0n));
    expect(r._bytes[r._bytes.length - 1]).toBe(OPS.INDEX);
    // idx (0) is emitted before the array bytes
    expect(Array.from(r._bytes.slice(0, 2))).toEqual([OPS.BYTE_1, 0]);
  });

  it('index result is a scalar (isDynamic=false)', () => {
    const s = S();
    expect(s.index(s.tuple([s.int(7n)]), s.int(0n)).isDynamic).toBe(false);
  });
});

describe('V12Saucer — SET_INDEX / NEW_ARRAY (postfix)', () => {
  it('setIndex emits [value][index][array][SET_INDEX] (value deepest, array on top)', () => {
    const s = S();
    // signature setIndex(array, index, value): array=7, index=1, value=9.
    const r = s.setIndex(s.int(7n), s.int(1n), s.int(9n));
    expect(Array.from(r._bytes)).toEqual([
      OPS.BYTE_1,
      9, // value (deepest)
      OPS.BYTE_1,
      1, // index
      OPS.BYTE_1,
      7, // array (on top)
      OPS.SET_INDEX,
    ]);
  });

  it('setIndex returns a non-dynamic descriptor and net stackEffect +1', () => {
    const s = S();
    const r = s.setIndex(s.int(7n), s.int(1n), s.int(9n));
    expect(r.isDynamic).toBe(false);
    // 3 operands pushed (+3), SET_INDEX leaves 1 → net +1.
    expect(r.stackEffect).toBe(1);
  });

  it('newArray emits [count][NEW_ARRAY] and is dynamic', () => {
    const s = S();
    const r = s.newArray(s.int(3n));
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 3, OPS.NEW_ARRAY]);
    expect(r.isDynamic).toBe(true);
    // operand pushes count (+1); NEW_ARRAY consumes it and pushes the descriptor
    // (net 0 on top of the operand) → overall +1, like a unary op.
    expect(r.stackEffect).toBe(1);
  });

  it('setIndex propagates REF sentinels at advancing positions/depths', () => {
    const c = paramCtx('arr', 'i', 'v');
    const s = new V12Saucer(c);
    // value=v (deepest), index=i, array=arr (top)
    const r = s.setIndex(s.read('arr'), s.read('i'), s.read('v'));
    expect(r.refPositions).toHaveLength(3);
    // emitted order: value(v) @0 depth0, index(i) @1 depth1, array(arr) @2 depth2
    expect(r.refPositions[0]).toMatchObject({ position: 0, depth: 0 });
    expect(r.refPositions[1]).toMatchObject({ position: 1, depth: 1 });
    expect(r.refPositions[2]).toMatchObject({ position: 2, depth: 2 });
  });
});

describe('V12Saucer — local slot variables (postfix)', () => {
  it('store emits [value][WRITE_VALUE][slot]; read emits [READ_VALUE][slot]', () => {
    const c = ctx();
    const stored = new V12Saucer(c).store('x', new V12Saucer(c).int(42n));
    expect(Array.from(stored._bytes)).toEqual([OPS.BYTE_1, 42, OPS.WRITE_VALUE, 0]);
    const read = new V12Saucer(c).read('x');
    expect(Array.from(read._bytes)).toEqual([OPS.READ_VALUE, 0]);
  });

  it('a dynamic value uses a heap slot', () => {
    const c = ctx();
    const stored = new V12Saucer(c).store('b', new V12Saucer(c).bytes(new Uint8Array([0xaa])));
    expect(Array.from(stored._bytes)).toEqual([OPS.BYTES, 1, 0xaa, OPS.WRITE_HEAP, 0]);
    expect(new V12Saucer(c).read('b').isDynamic).toBe(true);
  });
});

describe('V12Saucer — parameters live on the stack (REF/SET)', () => {
  it('reading a param emits an SDUP sentinel and records a refPosition', () => {
    const c = paramCtx('a', 'b');
    const r = new V12Saucer(c).read('b'); // b is stack pos 2
    expect(r._bytes.length).toBe(1);
    expect(r.refPositions).toHaveLength(1);
    expect(r.refPositions[0]).toMatchObject({ position: 0, paramIndex: 1, depth: 0 });
  });

  it('writing a param emits [value][SSWAP_n][SDROP]', () => {
    const c = paramCtx('a');
    const r = new V12Saucer(c).store('a', new V12Saucer(c).int(7n));
    // value 7, then SSWAP1 (pos 1), SDROP
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 7, OPS_V12.SSWAP1, OPS_V12.SDROP]);
  });

  it('REF sentinels propagate (position+depth shift) through a binary op', () => {
    const c = paramCtx('a', 'b');
    const s = new V12Saucer(c);
    const r = s.add(s.read('a'), s.read('b'));
    expect(r.refPositions).toHaveLength(2);
    // first ref (a) at byte 0, depth 0; second ref (b) at byte 1, depth 1
    expect(r.refPositions[0]).toMatchObject({ position: 0, paramIndex: 0, depth: 0 });
    expect(r.refPositions[1]).toMatchObject({ position: 1, paramIndex: 1, depth: 1 });
  });
});

describe('V12Saucer — CALL_FUNCTION sentinels', () => {
  it('records a call position with a 0xFF00|index sentinel', () => {
    const c = ctx();
    c.addFunc('inc');
    c.addFunc('main');
    const r = new V12Saucer(c).callFunction('inc', [new V12Saucer(c).int(5n)]);
    // [BYTE_1,5][CALL_FUNCTION][0xff][0x00][argCount=1]
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 5, OPS.CALL_FUNCTION, 0xff, 0x00, 1]);
    expect(r.callPositions).toHaveLength(1);
    expect(r.callPositions[0]).toMatchObject({ pos: 3, funcIndex: 0 });
  });
});

describe('V12Saucer — raw stack ops', () => {
  it('sswap/sdrop/srot emit single opcodes', () => {
    expect(Array.from(S().sswap(1)._bytes)).toEqual([OPS_V12.SSWAP1]);
    expect(Array.from(S().sswap(3)._bytes)).toEqual([OPS_V12.SSWAP3]);
    expect(Array.from(S().sdrop()._bytes)).toEqual([OPS_V12.SDROP]);
    expect(Array.from(S().srot()._bytes)).toEqual([OPS_V12.SROT]);
  });
  it('sswap range-checks', () => {
    expect(() => S().sswap(0)).toThrow(/range/);
    expect(() => S().sswap(17)).toThrow(/range/);
  });
});

describe('V12Saucer — control flow shapes', () => {
  it('if/then emits [cond][IF][skip][then]', () => {
    const s = S();
    const r = s.if(s.int(1n)).then(s.int(9n));
    // [BYTE_1,1][IF][skip=2][BYTE_1,9]
    expect(Array.from((r as V12Saucer)._bytes)).toEqual([OPS.BYTE_1, 1, OPS.IF, 2, OPS.BYTE_1, 9]);
  });

  it('if/then/else grows the IF skip past the JUMP', () => {
    const s = S();
    const r = s.if(s.int(1n)).then(s.int(9n)).else(s.int(8n)) as V12Saucer;
    // then-body(2) + JUMP(1) + count(1) = skip 4; JUMP elseLen=2; else [BYTE_1,8]
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 1, OPS.IF, 4, OPS.BYTE_1, 9, OPS.JUMP, 2, OPS.BYTE_1, 8]);
  });
});

describe('V12Saucer — signed/extended ops (v12-only)', () => {
  it('sShr and signExtend push operands in source order (neither swapped)', () => {
    const s = S();
    // sShr(value, shift) → [value][shift][S_AR]
    expect(Array.from(s.sShr(s.int(256n), s.int(2n))._bytes)).toEqual([OPS.BYTE_2, 1, 0, OPS.BYTE_1, 2, OPS.S_AR]);
    // signExtend(value, fromByte) → [value][fromByte][SIGN_EXTEND] — fromByte (the byte index)
    // ends on top so it is popped first, matching compiler-rs's math_operand_order.
    const se = s.signExtend(s.int(255n), s.int(0n));
    expect(Array.from(se._bytes)).toEqual([OPS.BYTE_1, 255, OPS.BYTE_1, 0, OPS.SIGN_EXTEND]);
  });
  it('cast/addMod/mulMod emit their opcodes', () => {
    const s = S();
    expect(s.castBe(s.bytes(new Uint8Array([1])))._bytes.at(-1)).toBe(OPS.CAST_BE);
    expect(s.addMod(s.int(1n), s.int(2n), s.int(3n))._bytes.at(-1)).toBe(OPS.ADD_MOD);
    expect(s.mulMod(s.int(1n), s.int(2n), s.int(3n))._bytes.at(-1)).toBe(OPS.MUL_MOD);
  });
});

describe('V12Saucer — control-flow widening (large bodies)', () => {
  // Force a body past the 1-byte (255) / 2-byte (65535) skip boundaries — the one
  // place v12 control-flow encoding is non-trivial — by stubbing `_bytes` directly
  // (mirrors the v1 saucer.test.ts approach).
  const big = (n: number): V12Saucer => {
    const s = S();
    (s as { _bytes: Uint8Array })._bytes = new Uint8Array(n);

    return s;
  };

  it('uses IF_2 (2-byte skip) for a then-body larger than 255 bytes', () => {
    const r = S().if(S().int(1n)).then(big(300)) as V12Saucer;
    // [BYTE_1,1] then IF_2 with a 2-byte skip == then-body length (300).
    expect(r._bytes[2]).toBe(OPS.IF_2);
    expect((r._bytes[3] << 8) | r._bytes[4]).toBe(300);
  });

  it('uses JUMP_2 for an else-body larger than 255 bytes', () => {
    const r = S().if(S().int(1n)).then(big(10)).else(big(300)) as V12Saucer;
    expect(Array.from(r._bytes)).toContain(OPS.JUMP_2);
  });

  it('uses JUMP_BACK_2 (and IF_2) for a loop body larger than 253 bytes', () => {
    const r = S().while(S().int(1n)).loop(big(300)) as V12Saucer;
    expect(Array.from(r._bytes)).toContain(OPS.JUMP_BACK_2);
    expect(Array.from(r._bytes)).toContain(OPS.IF_2);
  });

  it('throws when a then-body exceeds 65535 bytes', () => {
    expect(() => S().if(S().int(1n)).then(big(65536))).toThrow(/body too large: 65536/);
  });

  it('throws when an else-body exceeds 65535 bytes', () => {
    expect(() => S().if(S().int(1n)).then(big(10)).else(big(65536))).toThrow(/body too large: 65536/);
  });

  it('throws when a loop body exceeds 65535 bytes', () => {
    expect(() => S().while(S().int(1n)).loop(big(65536))).toThrow(/loop body too large: 65536/);
  });
});

describe('V12Saucer — catch / eval / external-call decode', () => {
  it('catch wraps a handler: [body][CATCH][len][handler]', () => {
    const body = S().int(7n); // [BYTE_1,7]
    const r = body.catch(S().int(9n)); // handler [BYTE_1,9], length 2
    expect(Array.from(r._bytes)).toEqual([OPS.BYTE_1, 7, OPS.CATCH, 2, OPS.BYTE_1, 9]);
  });

  it('catch throws when the handler exceeds 255 bytes', () => {
    const handler = S();
    (handler as { _bytes: Uint8Array })._bytes = new Uint8Array(256);
    expect(() => S().int(1n).catch(handler)).toThrow(/handler too large/);
  });

  it('eval emits the EVAL opcode and is dynamic', () => {
    const r = S().eval(S().bytes(new Uint8Array([1])));
    expect(r._bytes.at(-1)).toBe(OPS.EVAL);
    expect(r.isDynamic).toBe(true);
  });

  it('single-output external call decodes via ABI_DECODE then INDEX 0', () => {
    const r = S().staticCall(S().int(0xabcdn), S().bytes(new Uint8Array([1])), { count: 1, typeSpecs: [0] });
    const bytes = Array.from(r._bytes);
    expect(bytes).toContain(OPS.ABI_DECODE);
    expect(bytes.at(-1)).toBe(OPS.INDEX); // single output → element 0 of the decoded tuple
  });

  it('multi-output external call decodes to the whole tuple (no trailing INDEX)', () => {
    const r = S().staticCall(S().int(0xabcdn), S().bytes(new Uint8Array([1])), { count: 2, typeSpecs: [0, 0] });
    const bytes = Array.from(r._bytes);
    expect(bytes).toContain(OPS.ABI_DECODE);
    expect(bytes.at(-1)).not.toBe(OPS.INDEX);
    expect(r.isDynamic).toBe(true);
  });
});
