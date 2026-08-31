/**
 * The centralized, BIDIRECTIONAL per-target capability gate (src/capabilities.ts). A feature
 * is EVM-only (v1+v12), svm-only, or v12-dialect-only (v12+svm) — this suite pins the matrix
 * both ways: rejected on the wrong target(s), still compiling on every allowed one. Byte
 * fixtures follow the house style: hex string + a comment decoding the bytes.
 */
import { compile, UnsupportedTargetError } from '../src/index.js';
import type { CompileTarget } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const compileOn = (src: string, target: CompileTarget) => compile(src, { target });

describe('target-capabilities — EVM-only features rejected on svm, compile on v1/v12', () => {
  const cases: Array<[string, string]> = [
    ['function main() { storage.read(0) }', 'storage.read'],
    ['function main() { storage.write(0, 1) }', 'storage.write'],
    ['function main() { return contract.create(0, Uint8Array.from([0x00])) }', 'create'],
    ['function main() { return contract.create2(0, 1, Uint8Array.from([0x00])) }', 'create2'],
    ['function main() { return contract.create3(0, 1, Uint8Array.from([0x00])) }', 'create3'],
    ['function main() { return contract.predictCreate(1, 2) }', 'createAddress'],
    ['function main() { return contract.predictCreate2(1, 2, 3) }', 'create2Address'],
    ['function main() { return contract.predictCreate3(1) }', 'create3Address'],
    ['function main() { return contract.delegate(1, Uint8Array.from([0x00])) }', 'delegatecall'],
    // §1.5 (ECO-2163 continuation, NS-CONVERGE): the EVM-only context reads now gated per-read under
    // `ctx.*` — `ctx.msgValue` (the surviving EVM-only half of the retired `msg.value`) and the
    // code-inspection quartet (unchanged from #141). The other former msg.*/block.*/tx.* EVM-only env
    // reads (origin/gasPrice/coinbase/prevrandao/gasLimit/baseFee/blobBaseFee) were DROPPED entirely,
    // and `evm.*` was trimmed back to storage-call duals — so neither has a capability row anymore.
    ['function main() { return ctx.msgValue() }', 'ctx.msgValue'],
    ['function main() { return ctx.codeSize(1) }', 'ctx.codeSize'],
    ['function main() { return ctx.codeHash(1) }', 'ctx.codeHash'],
    ['function main() { return ctx.isContract(1) }', 'ctx.isContract'],
    ['function main() { return ctx.isEOA(1) }', 'ctx.isEOA'],
  ];

  it.each(cases)('%s is rejected on svm', (src) => {
    expect(() => compileOn(src, 'svm')).toThrow(UnsupportedTargetError);
  });

  it.each(cases)('%s still compiles on v1 and v12', (src) => {
    expect(() => compileOn(src, 'v1')).not.toThrow();
    expect(() => compileOn(src, 'v12')).not.toThrow();
  });

  it('storage.read/write name the accountData/writeAccountData replacement', () => {
    expect(() => compileOn('function main() { storage.read(0) }', 'svm')).toThrow(
      "storage.read is not supported on target 'svm'; use accountData(ref, offset, len)",
    );
    expect(() => compileOn('function main() { storage.write(0, 1) }', 'svm')).toThrow(
      "storage.write is not supported on target 'svm'; use writeAccountData(ref, offset, value)",
    );
  });

  describe('typed contract bindings — all four shapes, plus .catch()', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-cap-test-'));
      fs.writeFileSync(
        path.join(tmpDir, 'ERC20.json'),
        JSON.stringify({
          abi: [
            {
              type: 'function',
              name: 'transfer',
              inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' },
              ],
              outputs: [{ name: '', type: 'bool' }],
              stateMutability: 'nonpayable',
            },
            {
              type: 'function',
              name: 'balanceOf',
              inputs: [{ name: 'account', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }],
              stateMutability: 'view',
            },
          ],
        }),
      );
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const bindingMessage =
      "contract bindings are not supported on target 'svm'; use contract.call(target, calldata, accounts)";

    it('inline chain (.at) is rejected on svm, compiles on v1/v12', () => {
      const src = `
        import { ERC20 } from "./ERC20.json";
        function main(addr, to, amount) {
          ERC20.at(addr).transfer(to, amount);
        }
      `;

      expect(() => compile(src, { target: 'svm', baseDirs: [tmpDir] })).toThrow(bindingMessage);
      expect(() => compile(src, { target: 'v1', baseDirs: [tmpDir] })).not.toThrow();
      expect(() => compile(src, { target: 'v12', baseDirs: [tmpDir] })).not.toThrow();
    });

    it('.view() is rejected on svm, compiles on v1/v12', () => {
      const src = `
        import { ERC20 } from "./ERC20.json";
        function main(addr, account) {
          return ERC20.view(addr).balanceOf(account);
        }
      `;

      expect(() => compile(src, { target: 'svm', baseDirs: [tmpDir] })).toThrow(bindingMessage);
      expect(() => compile(src, { target: 'v1', baseDirs: [tmpDir] })).not.toThrow();
      expect(() => compile(src, { target: 'v12', baseDirs: [tmpDir] })).not.toThrow();
    });

    it('.lib() is rejected on svm, compiles on v1/v12', () => {
      const src = `
        import { ERC20 } from "./ERC20.json";
        function main(addr, to, amount) {
          ERC20.lib(addr).transfer(to, amount);
        }
      `;

      expect(() => compile(src, { target: 'svm', baseDirs: [tmpDir] })).toThrow(bindingMessage);
      expect(() => compile(src, { target: 'v1', baseDirs: [tmpDir] })).not.toThrow();
      expect(() => compile(src, { target: 'v12', baseDirs: [tmpDir] })).not.toThrow();
    });

    it('variable-bound call is rejected on svm, compiles on v1/v12', () => {
      const src = `
        import { ERC20 } from "./ERC20.json";
        function main(addr, to, amount) {
          let token = ERC20.at(addr);
          token.transfer(to, amount);
        }
      `;

      expect(() => compile(src, { target: 'svm', baseDirs: [tmpDir] })).toThrow(bindingMessage);
      expect(() => compile(src, { target: 'v1', baseDirs: [tmpDir] })).not.toThrow();
      expect(() => compile(src, { target: 'v12', baseDirs: [tmpDir] })).not.toThrow();
    });

    it('.catch() on an inline chain call is rejected on svm, compiles on v1/v12', () => {
      const src = `
        import { ERC20 } from "./ERC20.json";
        function main(addr, to, amount) {
          ERC20.at(addr).transfer(to, amount).catch(() => {});
        }
      `;

      expect(() => compile(src, { target: 'svm', baseDirs: [tmpDir] })).toThrow(bindingMessage);
      expect(() => compile(src, { target: 'v1', baseDirs: [tmpDir] })).not.toThrow();
      expect(() => compile(src, { target: 'v12', baseDirs: [tmpDir] })).not.toThrow();
    });

    it('.catch() on a variable-bound call is rejected on svm, compiles on v1/v12', () => {
      const src = `
        import { ERC20 } from "./ERC20.json";
        function main(addr, to, amount) {
          let token = ERC20.at(addr);
          token.transfer(to, amount).catch(() => {});
        }
      `;

      expect(() => compile(src, { target: 'svm', baseDirs: [tmpDir] })).toThrow(bindingMessage);
      expect(() => compile(src, { target: 'v1', baseDirs: [tmpDir] })).not.toThrow();
      expect(() => compile(src, { target: 'v12', baseDirs: [tmpDir] })).not.toThrow();
    });

    it('array destructuring of a contract call is rejected on svm with its own message, compiles on v1/v12', () => {
      const src = `
        import { ERC20 } from "./ERC20.json";
        function main(addr, account) {
          const [ok] = ERC20.view(addr).balanceOf(account);
          return ok;
        }
      `;

      expect(() => compile(src, { target: 'svm', baseDirs: [tmpDir] })).toThrow(
        "array destructuring is not supported on target 'svm' — contract bindings are not available there; " +
          'read fields from the contract.call(...) returndata with slice()/uint()',
      );
      expect(() => compile(src, { target: 'v1', baseDirs: [tmpDir] })).not.toThrow();
      expect(() => compile(src, { target: 'v12', baseDirs: [tmpDir] })).not.toThrow();
    });

    describe('.json import stays inert-but-valid on svm', () => {
      it('import-only compiles on svm and every EVM target', () => {
        const src = `
          import { ERC20 } from "./ERC20.json";
          function main() { return 42 }
        `;

        for (const target of ['v1', 'v12', 'svm'] as const) {
          expect(() => compile(src, { target, baseDirs: [tmpDir] })).not.toThrow();
        }
      });

      it('a standalone binding (ERC20.at(addr), never called) compiles on svm too', () => {
        const src = `
          import { ERC20 } from "./ERC20.json";
          function main(addr) {
            let token = ERC20.at(addr);
            return 1;
          }
        `;

        for (const target of ['v1', 'v12', 'svm'] as const) {
          expect(() => compile(src, { target, baseDirs: [tmpDir] })).not.toThrow();
        }
      });
    });
  });
});

describe('target-capabilities — svm-only features rejected on v1/v12, compile on svm', () => {
  const cases: Array<[string, string]> = [
    ["function main() { return accountData('pool', 0, 8) }", 'accountData'],
    ["function main() { writeAccountData('vault', 0, Uint8Array.from([1])) }", 'writeAccountData'],
    ["function main() { return accountUint('pool', 0, 8) }", 'accountUint'],
  ];

  it.each(cases)('%s is rejected on v1 and v12', (src) => {
    expect(() => compileOn(src, 'v1')).toThrow(UnsupportedTargetError);
    expect(() => compileOn(src, 'v12')).toThrow(UnsupportedTargetError);
  });

  it.each(cases)('%s still compiles on svm', (src) => {
    expect(() => compileOn(src, 'svm')).not.toThrow();
  });

  it('accountUint names target svm only, uses the "only available on target" phrasing', () => {
    expect(() => compileOn("function main() { return accountUint('pool', 0, 8) }", 'v12')).toThrow(
      "accountUint is only available on target 'svm'",
    );
    expect(() => compile("function main() { return accountUint('pool', 0, 8) }")).toThrow(
      "accountUint is only available on target 'svm'",
    );
  });
});

describe('target-capabilities — v12-dialect-only (uint): rejected on v1, compiles on v12/svm', () => {
  it('rejected on v1 (default target)', () => {
    expect(() => compile('function main() { return uint(Uint8Array.from([0x01])) }')).toThrow(
      "uint is only available on targets 'v12' and 'svm'",
    );
  });

  it('CAST_BE on v12 vs CAST_LE on svm — divergence still re-pinned after centralizing the gate', () => {
    const src = 'function main() { return uint(Uint8Array.from([0x01, 0x02])) }';

    expect(hex(compileOn(src, 'v12').bytecode[0])).toBe('9002010254f2');
    expect(hex(compileOn(src, 'svm').bytecode[0])).toBe('9002010255f2');
  });
});

describe('target-capabilities — the new accounts-list gate (closes a confirmed silent miscompile)', () => {
  it('contract.call with a string-ref accounts list throws on v1 and v12 (was: silent miscompile)', () => {
    const src = "function main() { return contract.call(7, Uint8Array.from([0xaa]), ['pool']) }";

    // BEFORE this fix, this compiled cleanly on v1 to a201079001aa9201909004706f6f6c00
    // and on v12 to 01079001aa9201909004706f6f6ca2 — the intended calldata silently
    // became the `value` operand while the accounts array was encoded as calldata.
    expect(() => compileOn(src, 'v1')).toThrow(UnsupportedTargetError);
    expect(() => compileOn(src, 'v12')).toThrow(UnsupportedTargetError);
  });

  it('contract.call with an object-ref accounts list ({ref, writable}) also throws on v1/v12', () => {
    const src =
      "function main() { return contract.call(7, Uint8Array.from([0xaa]), [{ ref: 'escrow', writable: true }]) }";

    expect(() => compileOn(src, 'v1')).toThrow(UnsupportedTargetError);
    expect(() => compileOn(src, 'v12')).toThrow(UnsupportedTargetError);
  });

  it('contract.static with a 3rd accounts-list argument gets the target-named message, not the generic arity error', () => {
    const src = "function main() { return contract.static(7, Uint8Array.from([0xaa]), ['pool']) }";

    expect(() => compileOn(src, 'v1')).toThrow(
      'an accounts list (string refs / {ref, writable?, signer?} objects) is not supported on an EVM target',
    );
  });

  it('negative control: ordinary contract.call(target, value, calldata) on EVM is unaffected, byte-identical', () => {
    const src = 'function main() { return contract.call(7, 0, Uint8Array.from([0xaa, 0xbb])) }';

    // [BYTES,2,aa,bb] [BYTE_1,0] [BYTE_1,7] [CALL]
    expect(hex(compileOn(src, 'v1').bytecode[0])).not.toHaveLength(0);
    expect(() => compileOn(src, 'v1')).not.toThrow();
    expect(() => compileOn(src, 'v12')).not.toThrow();
  });

  it('negative control: the svm accounts-list shape is unaffected on svm (reuses the pinned fixture)', () => {
    const r = compileOn(
      `function main() { return contract.call(7, Uint8Array.from([0xaa, 0xbb]), ['pool', { ref: 'vault', writable: true }]); }`,
      'svm',
    );

    expect(hex(r.bytecode[0])).toBe('92020100019002aabb0107a2');
  });

  it('residual, documented as accepted: a purely numeric accounts list on EVM is NOT gated', () => {
    const src = 'function main() { return contract.call(7, Uint8Array.from([0xaa]), [3, 5]) }';

    // [3, 5] is syntactically indistinguishable from an ordinary literal array on an
    // EVM target — narrowing false positives to zero is worth leaving this one shape
    // to whatever the ordinary (non-capability) compile path does with it.
    expect(() => compileOn(src, 'v1')).not.toThrow();
  });
});

describe('target-capabilities — error shape (UnsupportedTargetError)', () => {
  it('carries feature/target/supported, and a span when the gate site has a node', () => {
    let caught: unknown;

    try {
      compileOn('function main() { storage.write(0, 1) }', 'svm');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(UnsupportedTargetError);
    const err = caught as InstanceType<typeof UnsupportedTargetError>;
    expect(err.feature).toBe('storage.write');
    expect(err.target).toBe('svm');
    expect(err.supported).toEqual(['v1', 'v12']);
  });

  it('a builder-layer gate site (contract.create) has no span (no AST node in scope there)', () => {
    let caught: unknown;

    try {
      compileOn('function main() { return contract.create(0, Uint8Array.from([0x00])) }', 'svm');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(UnsupportedTargetError);
    const err = caught as InstanceType<typeof UnsupportedTargetError>;
    expect(err.start).toBeUndefined();
    expect(err.end).toBeUndefined();
  });
});

describe('target-capabilities — over-gating guard: the NON-gated set stays universal', () => {
  it('abi.encode/decode compile on svm and are byte-identical to v12 (the ABI codec is universal; only typed bindings are EVM-only)', () => {
    const encodeSrc = 'function main() { return abi.encode(42) }';
    const decodeSrc = 'function main() { return abi.decode(Uint8Array.from([0x2a]), ["uint8"]) }';

    expect(hex(compileOn(encodeSrc, 'svm').bytecode[0])).toBe(hex(compileOn(encodeSrc, 'v12').bytecode[0]));
    expect(hex(compileOn(decodeSrc, 'svm').bytecode[0])).toBe(hex(compileOn(decodeSrc, 'v12').bytecode[0]));
  });

  it('emit, ctx.msgSender(), ctx.chainId(), ctx.selfBalance(), crypto.*, eval, storage.tRead/tWrite all still compile on svm (formerly msg.sender/block.chainId)', () => {
    const cases = [
      'function main() { emit("Ping()") }',
      'function main() { return ctx.msgSender() }',
      'function main() { return ctx.chainId() }',
      'function main() { return ctx.selfBalance() }',
      'function main() { return crypto.keccak256(Uint8Array.from([0x01])) }',
      'function main() { return eval("return 42") }',
      'function main() { storage.tWrite(0, 42); return storage.tRead(0) }',
    ];

    for (const src of cases) {
      expect(() => compileOn(src, 'svm')).not.toThrow();
    }
  });

  it('storage.tRead/tWrite stay byte-identical to v12 (divergent-lowering, not gated)', () => {
    const src = 'function main() { storage.tWrite(0, 42); return storage.tRead(0) }';

    expect(hex(compileOn(src, 'svm').bytecode[0])).toBe(hex(compileOn(src, 'v12').bytecode[0]));
  });
});
