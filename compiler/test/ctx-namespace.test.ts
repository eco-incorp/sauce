import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

// §1.4 (compiler-parity): the unified `ctx.*` context namespace, adopted from compiler-rs.
// RS ships EXACTLY 7 members, ALL call-form (`ctx.foo()`), 6 nullary + `ctx.balance(addr)`.
// `self` is a METHOD here (unlike the `address.self` PROPERTY), and `gasPrice`/`origin` are
// deliberately NOT part of `ctx.*` (RS raises CtxUnknownMethod for them). See
// compiler/crates/sauce-core/src/lower/contract.rs:463-472 for the RS oracle.
//
// Parity assertion of choice: each `ctx.*` method must emit byte-identical bytecode to the
// pre-existing `msg.*`/`block.*`/`address.*` spelling it aliases, on every target.
describe('ctx.* context namespace (§1.4 RS parity)', () => {
  const eq = (a: string, b: string) => {
    expect(compile(`function main() { const x = ${a}; }`).bytecode[0]).toEqual(
      compile(`function main() { const x = ${b}; }`).bytecode[0],
    );
  };

  it('ctx.msgSender() === msg.sender', () => eq('ctx.msgSender()', 'msg.sender'));
  it('ctx.self() === address.self', () => eq('ctx.self()', 'address.self'));
  it('ctx.chainId() === block.chainId', () => eq('ctx.chainId()', 'block.chainId'));
  it('ctx.blockNumber() === block.number', () => eq('ctx.blockNumber()', 'block.number'));
  it('ctx.timestamp() === block.timestamp', () => eq('ctx.timestamp()', 'block.timestamp'));
  it('ctx.selfBalance() === address.balance', () => eq('ctx.selfBalance()', 'address.balance'));
  it('ctx.balance(a) === address.balanceOf(a)', () => eq('ctx.balance(0x1234n)', 'address.balanceOf(0x1234n)'));

  it('ctx.msgSender() emits MSG_SENDER directly', () => {
    const result = compile('function main() { const x = ctx.msgSender(); }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.MSG_SENDER]));
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
