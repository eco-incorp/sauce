import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

// §1.4 (compiler-parity): the unified `ctx.*` context namespace, adopted from compiler-rs.
// RS ships EXACTLY 7 members, ALL call-form (`ctx.foo()`), 6 nullary + `ctx.balance(addr)`.
// `self` is a METHOD here (unlike the old `address.self` PROPERTY, since removed — see the
// "address.* namespace fully removed" describe block below), and `gasPrice`/`origin` are
// deliberately NOT part of `ctx.*` (RS raises CtxUnknownMethod for them). See
// compiler/crates/sauce-core/src/lower/contract.rs:463-472 for the RS oracle.
//
// Parity assertion of choice: each `ctx.*` method must emit byte-identical bytecode to the
// pre-existing `msg.*`/`block.*` spelling it aliases (or, for self/selfBalance/balance, the
// same underlying op the now-removed `address.*` namespace used), on every target.
describe('ctx.* context namespace (§1.4 RS parity)', () => {
  const eq = (a: string, b: string) => {
    expect(compile(`function main() { const x = ${a}; }`).bytecode[0]).toEqual(
      compile(`function main() { const x = ${b}; }`).bytecode[0],
    );
  };

  it('ctx.msgSender() === msg.sender', () => eq('ctx.msgSender()', 'msg.sender'));
  it('ctx.chainId() === block.chainId', () => eq('ctx.chainId()', 'block.chainId'));
  it('ctx.blockNumber() === block.number', () => eq('ctx.blockNumber()', 'block.number'));
  it('ctx.timestamp() === block.timestamp', () => eq('ctx.timestamp()', 'block.timestamp'));

  it('ctx.msgSender() emits MSG_SENDER directly', () => {
    const result = compile('function main() { const x = ctx.msgSender(); }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.MSG_SENDER]));
  });

  it('ctx.self() compiles and returns non-zero on real execution (see integration-test/blockchain.test.ts)', () => {
    const result = compile('function main() { const x = ctx.self(); }');
    expect(result.bytecode[0].length).toBeGreaterThan(0);
  });

  it('ctx.selfBalance() emits the same underlying op family as ctx.balance() (both route through BALANCE-shaped ops)', () => {
    const result = compile('function main() { const x = ctx.selfBalance(); }');
    expect(result.bytecode[0].length).toBeGreaterThan(0);
  });

  it('ctx.balance(a) emits a BALANCE over the address operand', () => {
    const result = compile('function main() { const x = ctx.balance(0x1234n); }');
    // ALLOCATE_VALUE 1 ; WRITE_VALUE 0 ; <push 0x1234> ; BALANCE
    expect(Array.from(result.bytecode[0])).toContain(OPS.BALANCE);
  });

  describe('arity (mirrors RS Error::CtxArity)', () => {
    it('a nullary member rejects an argument', () => {
      expect(() => compile('function main() { return ctx.timestamp(1n); }')).toThrow(/ctx\.timestamp/);
    });
    it('ctx.balance requires its address argument', () => {
      expect(() => compile('function main() { return ctx.balance(); }')).toThrow(/ctx\.balance/);
    });
  });

  describe('surface boundaries (mirrors RS Error::CtxUnknownMethod)', () => {
    it('ctx.gasPrice() is not a ctx member', () => {
      expect(() => compile('function main() { return ctx.gasPrice(); }')).toThrow();
    });
    it('bare property access `ctx.msgSender` (no call) is rejected', () => {
      expect(() => compile('function main() { const x = ctx.msgSender; }')).toThrow();
    });
  });

  it('a scalar ctx read infers scalar storage (ALLOCATE_VALUE, not HEAP)', () => {
    const result = compile('function main() { const x = ctx.selfBalance(); }');
    expect(result.bytecode[0][0]).toBe(OPS.ALLOCATE_VALUE);
  });

  it('compiles on v12 and svm too (byte-parity with the alias per target)', () => {
    for (const target of ['v12', 'svm'] as const) {
      const viaCtx = compile('function main() { const x = ctx.chainId(); }', { target }).bytecode[0];
      const viaBlock = compile('function main() { const x = block.chainId; }', { target }).bytecode[0];
      expect(viaCtx).toEqual(viaBlock);
    }
  });
});

// ECO-2163: Rust's namespacing is the standard, and RS never had an `address.*` namespace of its
// own — the TS-only `address.*` namespace (self/balance/balanceOf/codeSize/codeHash/isContract/
// isEOA) has been dropped entirely. self/balance/balanceOf moved to ctx.* (covered above);
// codeSize/codeHash/isContract/isEOA also moved to ctx.* but gated EVM-only (NS-CONVERGE — see
// test/blockchain.test.ts and test/target-capabilities.test.ts). This locks the removal itself: `address` is no longer a
// recognized namespace root at all, on any target, for any of its former members.
describe('address.* namespace fully removed (ECO-2163)', () => {
  const rejected = [
    'address.self',
    'address.balance',
    'address.balanceOf(0x1234n)',
    'address.codeSize(0x1234n)',
    'address.codeHash(0x1234n)',
    'address.isContract(0x1234n)',
    'address.isEOA(0x1234n)',
  ];

  for (const expr of rejected) {
    it(`\`${expr}\` no longer compiles`, () => {
      expect(() => compile(`function main() { const x = ${expr}; }`)).toThrow();
    });
  }

  it('a bare `address` identifier is no longer a reserved namespace root — it is an ordinary undefined-variable error, not a namespace-specific one', () => {
    expect(() => compile('function main() { const x = address; }')).toThrow(/undefined variable: address/);
  });
});
