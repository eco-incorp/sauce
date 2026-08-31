/**
 * Target 'svm' — a v12 postfix dialect for the Solana engine: same assembler and
 * opcode table, divergent lowering for calls (accounts array, no value operand)
 * and storage (accountData/writeAccountData over account data), plus an ordered
 * account plan interned from symbolic refs. Byte fixtures follow the house style:
 * hex string + a comment decoding the bytes.
 */
import { compile } from '../src/index.js';
import type { ContractsConfig } from '../src/index.js';
import { OPS, SVM_UNSUPPORTED } from '../src/saucer/index.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const compileSvm = (src: string) => compile(src, { target: 'svm' });

describe('svm target — v12 dialect plumbing', () => {
  it('pure-compute program emits bytes identical to target v12', () => {
    const src = 'function main() { const a = 1 + 2; return a * 3 }';
    const v12 = compile(src, { target: 'v12' });
    const svm = compileSvm(src);

    expect(hex(svm.bytecode[0])).toBe(hex(v12.bytecode[0]));
  });

  it('accountPlan is present (empty metas) on svm and absent on v12/v1', () => {
    const src = 'function main() { return 42 }';

    expect(compileSvm(src).accountPlan).toEqual({ metas: [] });
    expect(compile(src, { target: 'v12' }).accountPlan).toBeUndefined();
    expect(compile(src).accountPlan).toBeUndefined();
  });

  it('transient storage (storage.tRead/tWrite) stays supported and byte-identical', () => {
    const src = 'function main() { storage.tWrite(0, 42); return storage.tRead(0) }';
    const svm = compileSvm(src);

    expect(hex(svm.bytecode[0])).toBe(hex(compile(src, { target: 'v12' }).bytecode[0]));
    expect(svm.bytecode[0]).toContain(OPS.TSTORE);
    expect(svm.bytecode[0]).toContain(OPS.TLOAD);
  });

  it('void main omits the result-MSTORE (the svm engine enters with an EMPTY stack)', () => {
    // v12's Huff runtime pushes a stack-bottom sentinel, so its trailing MSTORE on a
    // void main is harmless; the svm engine starts at depth 0 and the same MSTORE
    // would pop the empty stack (StackUnderflow aborts the transaction).
    const src = 'function main() { storage.tWrite(0, 42) }';

    // [BYTE_1,42] [BYTE_1,0] [TSTORE] — no trailing MSTORE (0xf2)
    expect(hex(compileSvm(src).bytecode[0])).toBe('012a0100c4');
    // v12 keeps the sentinel-backed MSTORE (byte layout unchanged)
    expect(hex(compile(src, { target: 'v12' }).bytecode[0])).toBe('012a0100c4f2');
  });
});

describe('svm target — contract.call / contract.static lowering', () => {
  it('contract.call(target, calldata, accounts) emits [accounts][calldata][target][CALL]', () => {
    const r = compileSvm(`
      function main() {
        return contract.call(7, Uint8Array.from([0xaa, 0xbb]), ['pool', { ref: 'vault', writable: true }]);
      }
    `);

    // [ARRAY,2,BYTE_1,00,01] [BYTES,2,aa,bb] [BYTE_1,07] [CALL]
    expect(hex(r.bytecode[0])).toBe('92020100019002aabb0107a2');
    expect(r.accountPlan).toEqual({
      metas: [
        { ref: 'pool', writable: false, signer: false },
        { ref: 'vault', writable: true, signer: false },
      ],
    });
  });

  it('contract.static is the same shape with STATIC (0xa3)', () => {
    const r = compileSvm(`
      function main() {
        return contract.static(7, Uint8Array.from([0xaa, 0xbb]), ['pool', { ref: 'vault', writable: true }]);
      }
    `);

    // [ARRAY,2,BYTE_1,00,01] [BYTES,2,aa,bb] [BYTE_1,07] [STATIC]
    expect(hex(r.bytecode[0])).toBe('92020100019002aabb0107a3');
  });

  it('.catch() on an svm raw call emits [call][CATCH][len][handler]', () => {
    const r = compileSvm(`
      function main() {
        contract.call(7, Uint8Array.from([0xaa]), ['pool']).catch(() => {});
      }
    `);

    // [ARRAY,1,BYTE_1,00] [BYTES,1,aa] [BYTE_1,07] [CALL] [CATCH,0] [SDROP]
    expect(hex(r.bytecode[0])).toBe('920101009001aa0107a2b700e0');
  });

  it('raw numeric indices bypass the plan (escape hatch)', () => {
    const r = compileSvm(`
      function main() {
        return contract.call(7, Uint8Array.from([0xaa]), [3, 5]);
      }
    `);

    // [ARRAY,2,BYTE_1,03,05] [BYTES,1,aa] [BYTE_1,07] [CALL]
    expect(hex(r.bytecode[0])).toBe('92020103059001aa0107a2');
    expect(r.accountPlan).toEqual({ metas: [], usesRawIndices: true });
  });

  it('signer flag is recorded on the meta', () => {
    const r = compileSvm(`
      function main() {
        return contract.call(7, Uint8Array.from([0xaa]), [{ ref: 'payer', signer: true }]);
      }
    `);

    expect(r.accountPlan).toEqual({ metas: [{ ref: 'payer', writable: false, signer: true }] });
  });
});

describe('svm target — ref interning (dedup, flag merge, ordering)', () => {
  it('re-interning a ref keeps its index and ORs flags (readonly then writable)', () => {
    const r = compileSvm(`
      function main() {
        return contract.call(7, Uint8Array.from([0xaa]), ['pool', 'pool', { ref: 'pool', writable: true }]);
      }
    `);

    // All three entries resolve to index 0: [ARRAY,3,BYTE_1,00,00,00] …
    expect(hex(r.bytecode[0])).toBe('9203010000009001aa0107a2');
    expect(r.accountPlan).toEqual({ metas: [{ ref: 'pool', writable: true, signer: false }] });
  });

  it('ordering is first use across helper functions (helpers compile before main)', () => {
    const r = compileSvm(`
      function readPool() { return accountData('pool', 0, 8) }
      function main() {
        return contract.call(7, readPool(), [{ ref: 'pool', writable: true }, 'vault']);
      }
    `);

    // 'pool' interned first (readonly, in readPool), merged writable by main; 'vault' second.
    expect(r.accountPlan).toEqual({
      metas: [
        { ref: 'pool', writable: true, signer: false },
        { ref: 'vault', writable: false, signer: false },
      ],
    });
  });
});

describe('svm target — accountData / writeAccountData', () => {
  it('accountData(ref, offset, len) emits [len][offset][index][SLOAD]', () => {
    const r = compileSvm(`function main() { return accountData('pool', 4, 32) }`);

    // [BYTE_1,32] [BYTE_1,4] [BYTE_1,0] [SLOAD] — index on top, then offset, then len
    expect(hex(r.bytecode[0])).toBe('01200104010081');
    expect(r.accountPlan).toEqual({ metas: [{ ref: 'pool', writable: false, signer: false }] });
  });

  it('writeAccountData(ref, offset, value) emits [value][offset][index][SSTORE], pushes nothing', () => {
    const r = compileSvm(`
      function main() {
        writeAccountData('vault', 8, Uint8Array.from([0x01, 0x02]));
      }
    `);

    // [BYTES,2,01,02] [BYTE_1,8] [BYTE_1,0] [SSTORE] — no SDROP (the statement is
    // net-neutral, dropIfUnused is a no-op on it) and no result-MSTORE (void main).
    expect(hex(r.bytecode[0])).toBe('9002010201080100c5');
    expect(r.accountPlan).toEqual({ metas: [{ ref: 'vault', writable: true, signer: false }] });
  });

  it('writeAccountData MSTORE-wraps a scalar value into a Bytes descriptor', () => {
    // The engine's SSTORE pops the value with pop_descriptor() and rejects
    // non-Bytes — a bare scalar would abort the transaction (ExpectedDescriptor).
    const r = compileSvm(`function main() { writeAccountData('vault', 8, 42) }`);

    // [BYTE_1,42] [MSTORE (wrap → 32-byte word)] [BYTE_1,8] [BYTE_1,0] [SSTORE]
    expect(hex(r.bytecode[0])).toBe('012af201080100c5');
    expect(r.accountPlan).toEqual({ metas: [{ ref: 'vault', writable: true, signer: false }] });
  });

  it('accountData accepts a raw numeric index', () => {
    const r = compileSvm(`function main() { return accountData(2, 8, 16) }`);

    // [BYTE_1,16] [BYTE_1,8] [BYTE_1,2] [SLOAD]
    expect(hex(r.bytecode[0])).toBe('01100108010281');
    expect(r.accountPlan).toEqual({ metas: [], usesRawIndices: true });
  });
});

describe('svm target — uint() lowering divergence and the accountUint sugar (CAST_BE 0x54 / CAST_LE 0x55)', () => {
  it('uint(bytes) lowers to the platform-native cast: CAST_LE on svm, CAST_BE on v12', () => {
    const src = 'function main() { return uint(Uint8Array.from([0x01, 0x02])) }';

    // svm: [BYTES,2,01,02] [CAST_LE] [MSTORE (scalar main result)]
    expect(hex(compileSvm(src).bytecode[0])).toBe('9002010255f2');
    // same source on v12: [BYTES,2,01,02] [CAST_BE] [MSTORE]
    expect(hex(compile(src, { target: 'v12' }).bytecode[0])).toBe('9002010254f2');
  });

  it('accountUint(ref, offset, width) is uint over the accountData read — ONE op, CAST_LE, no CAST_BE', () => {
    const r = compileSvm(`function main() { return accountUint('pool', 64, 8) }`);

    // [BYTE_1,8 (len)] [BYTE_1,64 (offset)] [BYTE_1,0 (index)] [SLOAD] [CAST_LE] [MSTORE]
    expect(hex(r.bytecode[0])).toBe('0108014001008155f2');
    expect(r.accountPlan).toEqual({ metas: [{ ref: 'pool', writable: false, signer: false }] });
  });

  it('accountUint accepts a raw numeric index (escape hatch)', () => {
    const r = compileSvm('function main() { return accountUint(2, 8, 8) }');

    // [BYTE_1,8 (len)] [BYTE_1,8 (offset)] [BYTE_1,2 (index)] [SLOAD] [CAST_LE] [MSTORE]
    expect(hex(r.bytecode[0])).toBe('0108010801028155f2');
    expect(r.accountPlan).toEqual({ metas: [], usesRawIndices: true });
  });

  it('uint is v12-dialect only (the v1 engine has no cast op)', () => {
    expect(() => compile('function main() { return uint(Uint8Array.from([0x01])) }')).toThrow(
      "uint is only available on targets 'v12' and 'svm'",
    );
  });

  it('accountUint is svm-only (accountData is)', () => {
    expect(() => compile(`function main() { return accountUint('pool', 0, 8) }`, { target: 'v12' })).toThrow(
      "accountUint is only available on target 'svm'",
    );
    expect(() => compile(`function main() { return accountUint('pool', 0, 8) }`)).toThrow(
      "accountUint is only available on target 'svm'",
    );
  });

  it('width must be an integer literal 1-32', () => {
    const message = 'accountUint width must be an integer literal between 1 and 32';

    expect(() => compileSvm(`function main() { return accountUint('pool', 0, 0) }`)).toThrow(message);
    expect(() => compileSvm(`function main() { return accountUint('pool', 0, 33) }`)).toThrow(message);
    expect(() => compileSvm(`function main() { return accountUint('pool', 0, 8.5) }`)).toThrow(message);
    expect(() => compileSvm(`function main(w) { return accountUint('pool', 0, w) }`)).toThrow(message);
  });
});

describe('svm target — gating errors', () => {
  const svmThrows = (src: string, message: string): void => {
    expect(() => compileSvm(src)).toThrow(message);
  };

  it('create family is rejected, each op named', () => {
    svmThrows(
      'function main() { return contract.create(0, Uint8Array.from([0x00])) }',
      "create is not supported on target 'svm'",
    );
    svmThrows(
      'function main() { return contract.create2(0, 1, Uint8Array.from([0x00])) }',
      "create2 is not supported on target 'svm'",
    );
    svmThrows(
      'function main() { return contract.create3(0, 1, Uint8Array.from([0x00])) }',
      "create3 is not supported on target 'svm'",
    );
    svmThrows(
      'function main() { return contract.predictCreate(1, 2) }',
      "createAddress is not supported on target 'svm'",
    );
    svmThrows(
      'function main() { return contract.predictCreate2(1, 2, 3) }',
      "create2Address is not supported on target 'svm'",
    );
    svmThrows(
      'function main() { return contract.predictCreate3(1) }',
      "create3Address is not supported on target 'svm'",
    );
  });

  it('delegatecall is rejected', () => {
    svmThrows(
      'function main() { return contract.delegate(1, Uint8Array.from([0x00])) }',
      "delegatecall is not supported on target 'svm'",
    );
  });

  it('SVM_UNSUPPORTED mirrors the opcode table byte-for-byte (the map hand-writes the bytes)', () => {
    expect(SVM_UNSUPPORTED).toEqual({
      create: OPS.CREATE,
      createAddress: OPS.CREATE_ADDRESS,
      create2: OPS.CREATE2,
      create2Address: OPS.CREATE2_ADDRESS,
      create3: OPS.CREATE3,
      create3Address: OPS.CREATE3_ADDRESS,
      delegatecall: OPS.DELEGATE,
    });
  });

  it('EVM slot storage is rejected with the accountData replacement named', () => {
    svmThrows(
      'function main() { return storage.read(0) }',
      "storage.read is not supported on target 'svm'; use accountData(ref, offset, len)",
    );
    svmThrows(
      'function main() { storage.write(0, 1) }',
      "storage.write is not supported on target 'svm'; use writeAccountData(ref, offset, value)",
    );
  });

  it('typed contract bindings are rejected (inline chain, .view(), .lib(), variable-bound, standalone-then-call)', () => {
    const contracts: ContractsConfig = {
      ERC20: {
        abi: [
          {
            type: 'function',
            name: 'transfer',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ type: 'bool' }],
          },
        ],
      },
    };
    const message =
      "contract bindings are not supported on target 'svm'; use contract.call(target, calldata, accounts)";

    expect(() => compile('function main() { ERC20.at(7).transfer(8, 9) }', { target: 'svm', contracts })).toThrow(
      message,
    );
    expect(() => compile('function main() { ERC20.view(7).transfer(8, 9) }', { target: 'svm', contracts })).toThrow(
      message,
    );
    expect(() => compile('function main() { ERC20.lib(7).transfer(8, 9) }', { target: 'svm', contracts })).toThrow(
      message,
    );
    expect(() =>
      compile('function main() { const t = ERC20.at(7); t.transfer(8, 9); }', { target: 'svm', contracts }),
    ).toThrow(message);
    expect(() =>
      compile('function main() { const t = ERC20.lib(7); t.transfer(8, 9); }', { target: 'svm', contracts }),
    ).toThrow(message);
  });

  it('accountData/writeAccountData are svm-only', () => {
    expect(() => compile(`function main() { return accountData('pool', 0, 8) }`, { target: 'v12' })).toThrow(
      "accountData is only available on target 'svm'",
    );
    expect(() => compile(`function main() { return accountData('pool', 0, 8) }`)).toThrow(
      "accountData is only available on target 'svm'",
    );
    expect(() => compile(`function main() { writeAccountData('vault', 0, msg.data) }`, { target: 'v12' })).toThrow(
      "writeAccountData is only available on target 'svm'",
    );
  });

  it('accounts list over the 64-account CPI cap is rejected', () => {
    const indices = Array.from({ length: 65 }, (_, i) => i).join(', ');
    svmThrows(
      `function main() { return contract.call(7, Uint8Array.from([0xaa]), [${indices}]) }`,
      'contract.call accounts list exceeds the 64-account CPI cap (got 65)',
    );
  });

  it('non-array accounts argument is rejected (also catches EVM-style value)', () => {
    svmThrows(
      'function main() { return contract.call(7, Uint8Array.from([0xaa]), 5) }',
      "contract.call on target 'svm' expects (target, calldata, accounts[])",
    );
    // EVM-style contract.call(target, value, calldata) — the calldata lands in accounts position.
    svmThrows(
      'function main() { return contract.call(7, 0, Uint8Array.from([0xaa])) }',
      "contract.call on target 'svm' expects (target, calldata, accounts[])",
    );
  });

  it('invalid accounts entries are rejected', () => {
    const message =
      'contract.call accounts entries must be string refs, {ref, writable?, signer?} objects, or integer indices';
    svmThrows(`function main() { return contract.call(7, Uint8Array.from([0xaa]), [true]) }`, message);
    svmThrows(`function main() { return contract.call(7, Uint8Array.from([0xaa]), [300]) }`, message);
    svmThrows(`function main() { return contract.call(7, Uint8Array.from([0xaa]), [{ writable: true }]) }`, message);
    // Computed keys are not the plain-literal object shape, even when the key
    // expression happens to evaluate to a known flag name.
    svmThrows(
      `function main() { return contract.call(7, Uint8Array.from([0xaa]), [{ ref: 'pool', ['writable']: true }]) }`,
      message,
    );
    svmThrows(
      `function main() { return contract.call(7, Uint8Array.from([0xaa]), [{ ref: 'pool', [writable]: true }]) }`,
      message,
    );
  });

  it('mixing raw indices and symbolic refs is rejected (in one list and across statements)', () => {
    const message = 'cannot mix raw account indices and symbolic account refs';
    svmThrows(`function main() { return contract.call(7, Uint8Array.from([0xaa]), [3, 'pool']) }`, message);
    svmThrows(`function main() { const a = accountData(0, 0, 1); return accountData('pool', 0, 1) }`, message);
  });

  it('interning ref #256 overflows the u8 index space', () => {
    const body = Array.from({ length: 257 }, (_, i) => `accountData('a${i}', 0, 1);`).join('\n');
    svmThrows(`function main() { ${body} }`, "too many accounts: ref 'a256' would need index 256 (max 255)");
  });

  it('eval() with account refs is rejected; plain eval compute still works', () => {
    svmThrows(
      `function main() { return eval("return accountData('pool', 0, 8)") }`,
      "account refs inside eval() are not supported on target 'svm'",
    );

    const r = compileSvm('function main() { return eval("return 1 + 2") }');

    expect(r.bytecode[0]).toContain(OPS.EVAL);
    expect(r.accountPlan).toEqual({ metas: [] });
  });

  it('raw indices inside eval() propagate raw mode (mixing with outer refs still throws)', () => {
    // EVAL shares the outer instruction's account list, so a raw index inside
    // eval'd code locks the whole compile to raw mode — a symbolic ref outside
    // would silently disagree with the hand-picked indices.
    svmThrows(
      `function main() { const x = eval("return accountData(3, 0, 8)"); return accountData('pool', 0, 8) }`,
      'cannot mix raw account indices and symbolic account refs',
    );
    svmThrows(
      `function main() { const x = accountData('pool', 0, 8); return eval("return accountData(3, 0, 8)") }`,
      'cannot mix raw account indices and symbolic account refs',
    );

    // All-raw programs keep the escape hatch, eval included.
    const r = compileSvm(
      `function main() { const x = eval("return accountData(3, 0, 8)"); return accountData(5, 0, 8) }`,
    );

    expect(r.accountPlan).toEqual({ metas: [], usesRawIndices: true });
  });
});
