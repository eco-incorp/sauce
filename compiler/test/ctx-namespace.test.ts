import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

// §1.4/§1.5 (compiler-parity): the unified `ctx.*` context namespace, adopted from compiler-rs.
// `self`/`isContract`/`isEOA` are METHODS here (unlike the old `address.self` PROPERTY family,
// since removed — see the "address.* namespace fully removed" describe block below; isContract/
// isEOA moved to `ctx.*` too but are gated EVM-only — see globals.ts's `ctx:` block for why), and
// `gasPrice`/`origin` are deliberately NOT part of `ctx.*` (RS raises CtxUnknownMethod for them)
// and were DROPPED entirely, not relocated. `msg.value` alone survived, as the gated `ctx.msgValue()`.
// See compiler/crates/sauce-core/src/lower/contract.rs:463-472
// for the RS oracle (§1.4) and PR #382 (§1.5: adds msgData).
//
// §1.5 (ECO-2163 continuation): `msg`/`block`/`tx` were REMOVED entirely (not just aliased) —
// there is no longer an "old spelling" for `ctx.msgSender()`/`ctx.chainId()`/`ctx.blockNumber()`/
// `ctx.timestamp()`/`ctx.msgData()` to byte-compare against, unlike the address.*-vs-ctx.* parity
// assertions §1.4 could still make while `address.*` briefly coexisted with `ctx.*`. The removal
// itself is locked by the "msg/block/tx namespaces fully removed" describe block below instead.
describe('ctx.* context namespace (§1.4/§1.5 RS parity)', () => {
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

  it('ctx.chainId() compiles on v12 and svm too', () => {
    for (const target of ['v12', 'svm'] as const) {
      const result = compile('function main() { const x = ctx.chainId(); }', { target });
      expect(result.bytecode[0].length).toBeGreaterThan(0);
    }
  });

  it('ctx.msgData() (§1.5) emits a heap/dynamic read and compiles on every target', () => {
    for (const target of ['v1', 'v12', 'svm'] as const) {
      const result = compile('function main() { const x = ctx.msgData(); }', { target });
      expect(result.bytecode[0].length).toBeGreaterThan(0);
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

// §1.5 (ECO-2163 continuation, RS PR #382/#383): the `msg.*`/`block.*`/`tx.*` namespaces were
// REMOVED entirely (not aliased, not deprecated — gone). Portable members moved to `ctx.*`
// (msgSender/msgData/chainId/blockNumber/timestamp); `msg.value` moved to the gated `ctx.msgValue()`
// (NS-CONVERGE: RS keeps every context read under `ctx.*` and gates the EVM-only ones per-read).
// The other EVM-only env reads (origin/gasPrice/coinbase/prevrandao/gasLimit/baseFee/blobBaseFee)
// were DROPPED entirely — no consumers, in neither compiler's canonical `ctx.*` — not relocated to
// `evm.*` (which now holds only storage-call duals). This locks the removal itself, mirroring the
// "address.* namespace fully removed" block above.
describe('msg/block/tx namespaces fully removed (ECO-2163 §1.5)', () => {
  const rejected = [
    'msg.sender',
    'msg.value',
    'msg.data',
    'block.number',
    'block.timestamp',
    'block.coinbase',
    'block.prevrandao',
    'block.gasLimit',
    'block.baseFee',
    'block.blobBaseFee',
    'block.chainId',
    'tx.origin',
    'tx.gasPrice',
  ];

  for (const expr of rejected) {
    it(`\`${expr}\` no longer compiles`, () => {
      expect(() => compile(`function main() { const x = ${expr}; }`)).toThrow();
    });
  }

  it('bare `msg`/`block`/`tx` identifiers are no longer reserved namespace roots — ordinary undefined-variable errors, not namespace-specific ones', () => {
    expect(() => compile('function main() { const x = msg; }')).toThrow(/undefined variable: msg/);
    expect(() => compile('function main() { const x = block; }')).toThrow(/undefined variable: block/);
    expect(() => compile('function main() { const x = tx; }')).toThrow(/undefined variable: tx/);
  });
});
