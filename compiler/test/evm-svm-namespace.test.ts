/**
 * §1.3 (compiler-parity): the target-namespaced `evm.*` / `svm.*` builtins, adopted from
 * compiler-rs. `evm.*` is EVM-only (v1/v12), `svm.*` is svm-only — the exact bidirectional
 * split RS enforces via `require_available(target, Builtin::{Evm,Svm}*)`
 * (sauce-core/src/lower/contract.rs `evm_call`/`svm_call`, statement.rs `evm_sstore`/`svm_sstore`).
 *
 * Oracle target-mismatch tests borrowed from RS: `evm_sload_compiled_for_the_svm_is_unsupported`,
 * `svm_sload_compiled_for_the_evm_is_unsupported`, `svm_sstore_compiled_for_the_evm_is_unsupported`,
 * `svm_call_compiled_for_the_evm_is_unsupported`, `evm_sstore_compiled_for_the_svm_is_unsupported`.
 *
 * Parity assertion of choice (as in ctx-namespace.test.ts): each `evm.*`/`svm.*` member emits
 * byte-identical bytecode to the pre-existing storage/contract/accountData spelling it aliases,
 * on every target it is valid on.
 */
import { compile, UnsupportedTargetError } from '../src/index.js';
import type { CompileTarget } from '../src/index.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const on = (src: string, target: CompileTarget) => compile(src, { target });

describe('evm.* namespace (§1.3 RS parity) — EVM-only, byte-identical to storage.*/contract.*', () => {
  const evmEq = (a: string, b: string) => {
    for (const target of ['v1', 'v12'] as const) {
      expect(hex(on(`function main() { ${a} }`, target).bytecode[0])).toEqual(
        hex(on(`function main() { ${b} }`, target).bytecode[0]),
      );
    }
  };

  it('evm.sload(slot) === storage.read(slot)', () => evmEq('return evm.sload(3n)', 'return storage.read(3n)'));

  it('evm.sstore(slot, v) === storage.write(slot, v)', () =>
    evmEq('evm.sstore(7n, 9n)', 'storage.write(7n, 9n)'));

  it('evm.call(addr, value, data) === contract.call(addr, value, data)', () =>
    evmEq(
      'return evm.call(7n, 0n, Uint8Array.from([0xaa]))',
      'return contract.call(7n, 0n, Uint8Array.from([0xaa]))',
    ));

  it('evm.static(addr, data) === contract.static(addr, data)', () =>
    evmEq('return evm.static(7n, Uint8Array.from([0xaa]))', 'return contract.static(7n, Uint8Array.from([0xaa]))'));

  it('evm.delegate(addr, data) === contract.delegate(addr, data)', () =>
    evmEq(
      'return evm.delegate(7n, Uint8Array.from([0xaa]))',
      'return contract.delegate(7n, Uint8Array.from([0xaa]))',
    ));

  describe('rejected on svm (RS evm_*_compiled_for_the_svm_is_unsupported)', () => {
    const svmRejected: Array<[string, string]> = [
      ['evm.sload', 'function main() { return evm.sload(3n) }'],
      ['evm.sstore', 'function main() { evm.sstore(7n, 9n) }'],
      ['evm.call', 'function main() { return evm.call(7n, 0n, Uint8Array.from([0xaa])) }'],
      ['evm.static', 'function main() { return evm.static(7n, Uint8Array.from([0xaa])) }'],
      ['evm.delegate', 'function main() { return evm.delegate(7n, Uint8Array.from([0xaa])) }'],
    ];

    it.each(svmRejected)('%s throws UnsupportedTargetError on svm', (_name, src) => {
      expect(() => on(src, 'svm')).toThrow(UnsupportedTargetError);
    });

    it("evm.sload names the target in its message", () => {
      expect(() => on('function main() { return evm.sload(3n) }', 'svm')).toThrow(
        "evm.sload is not supported on target 'svm'",
      );
    });
  });
});

describe('svm.* namespace (§1.3 RS parity) — svm-only, byte-identical to accountData/writeAccountData/contract.call', () => {
  const svmEq = (a: string, b: string) => {
    const ra = on(`function main() { ${a} }`, 'svm');
    const rb = on(`function main() { ${b} }`, 'svm');

    expect(hex(ra.bytecode[0])).toEqual(hex(rb.bytecode[0]));
    expect(ra.accountPlan).toEqual(rb.accountPlan);
  };

  it('svm.sload(acct, off, len) === accountData(acct, off, len)', () =>
    svmEq("return svm.sload('pool', 0, 32)", "return accountData('pool', 0, 32)"));

  it('svm.sstore(acct, off, value) === writeAccountData(acct, off, value)', () =>
    svmEq("svm.sstore('vault', 0, abi.encode(42))", "writeAccountData('vault', 0, abi.encode(42))"));

  it('svm.call(program, accounts, data) === contract.call(program, data, accounts)', () =>
    svmEq(
      "return svm.call(7, ['pool', { ref: 'vault', writable: true }], Uint8Array.from([0xaa, 0xbb]))",
      "return contract.call(7, Uint8Array.from([0xaa, 0xbb]), ['pool', { ref: 'vault', writable: true }])",
    ));

  describe('rejected on EVM targets (RS svm_*_compiled_for_the_evm_is_unsupported)', () => {
    const evmRejected: Array<[string, string]> = [
      ['svm.sload', "function main() { return svm.sload('pool', 0, 32) }"],
      ['svm.sstore', "function main() { svm.sstore('vault', 0, abi.encode(42)) }"],
      ['svm.call', "function main() { return svm.call(7, ['pool'], Uint8Array.from([0xaa])) }"],
    ];

    it.each(evmRejected)('%s throws UnsupportedTargetError on v1', (_name, src) => {
      expect(() => on(src, 'v1')).toThrow(UnsupportedTargetError);
    });

    it.each(evmRejected)('%s throws UnsupportedTargetError on v12', (_name, src) => {
      expect(() => on(src, 'v12')).toThrow(UnsupportedTargetError);
    });

    it('svm.sload names the target in its message', () => {
      expect(() => on("function main() { return svm.sload('pool', 0, 32) }", 'v1')).toThrow(
        "svm.sload is only available on target 'svm'",
      );
    });
  });
});

describe('evm.*/svm.* surface boundaries (call-only, unknown-member)', () => {
  it('bare property access `evm.sload` (no call) is rejected', () => {
    expect(() => compile('function main() { const x = evm.sload; }')).toThrow();
  });

  it('bare property access `svm.sload` (no call) is rejected', () => {
    expect(() => compile('function main() { const x = svm.sload; }', { target: 'svm' })).toThrow();
  });

  it('an unknown evm.* member is rejected', () => {
    expect(() => compile('function main() { return evm.frobnicate(1n) }')).toThrow();
  });

  it('an unknown svm.* member is rejected', () => {
    expect(() => compile('function main() { return svm.frobnicate(1n) }', { target: 'svm' })).toThrow();
  });

  it('evm/svm are reserved as binding names (RS Namespace rule)', () => {
    expect(() => compile('function main() { let evm = 1n; return evm; }')).toThrow();
    expect(() => compile('function main() { let svm = 1n; return svm; }')).toThrow();
  });
});
