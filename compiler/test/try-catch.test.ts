import { compile } from '../src/index.js';
import { Saucer, OPS } from '../src/saucer/index.js';
import { CompilerContext } from '../src/context.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tmpDir: string;

const erc20Abi = [
  {
    type: 'function' as const,
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable' as const,
  },
  {
    type: 'function' as const,
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view' as const,
  },
];

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-trycatch-test-'));
  fs.writeFileSync(path.join(tmpDir, 'ERC20.json'), JSON.stringify({ abi: erc20Abi }));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const transferSelector = [0xa9, 0x05, 0x9c, 0xbb];

describe('saucer catch() method', () => {
  it('appends CATCH opcode with handler bytes', () => {
    const ctx = new CompilerContext();
    const call = new Saucer(ctx).int(42n);
    const handler = new Saucer(ctx).int(0n);

    const result = call.catch(handler);

    const bytes = Array.from(result._bytes);
    // call bytes + CATCH + handler_len + handler bytes
    expect(bytes).toEqual([...call._bytes, OPS.CATCH, handler._bytes.length, ...handler._bytes]);
  });

  it('appends CATCH with empty handler', () => {
    const ctx = new CompilerContext();
    const call = new Saucer(ctx).int(1n);
    const handler = new Saucer(ctx);

    const result = call.catch(handler);

    const bytes = Array.from(result._bytes);
    expect(bytes).toEqual([...call._bytes, OPS.CATCH, 0]);
  });

  it('throws when handler exceeds 255 bytes', () => {
    const ctx = new CompilerContext();
    const call = new Saucer(ctx).int(1n);
    const handler = new Saucer(ctx);
    (handler as { _bytes: Uint8Array })._bytes = new Uint8Array(256);

    expect(() => call.catch(handler)).toThrow('catch handler too large: 256 bytes exceeds 255');
  });

  it('allows handler of exactly 255 bytes', () => {
    const ctx = new CompilerContext();
    const call = new Saucer(ctx).int(1n);
    const handler = new Saucer(ctx);
    (handler as { _bytes: Uint8Array })._bytes = new Uint8Array(255);

    const result = call.catch(handler);
    const bytes = result._bytes;
    // CATCH byte + length byte (255) + 255 handler bytes
    expect(bytes[bytes.length - 257]).toBe(OPS.CATCH);
    expect(bytes[bytes.length - 256]).toBe(255);
  });
});

describe('.catch() compilation', () => {
  it('nonpayable call with .catch() emits CALL + CATCH (no output decode)', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.at(addr).transfer(to, amount).catch(() => {});
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    expect(bytes).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        3,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        1,
        OPS.BYTE_1,
        2,
        OPS.WRITE_VALUE,
        2,
        OPS.BYTE_1,
        3,
        // CALL without INDEX/ABI_DECODE wrapping (skipOutput)
        OPS.CALL,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        0,
        OPS.CONCAT,
        2,
        OPS.BYTES,
        4,
        ...transferSelector,
        OPS.ABI_ENCODE,
        OPS.TUPLE,
        2,
        OPS.READ_VALUE,
        1,
        OPS.READ_VALUE,
        2,
        // CATCH with empty handler
        OPS.CATCH,
        0,
      ]),
    );
  });

  it('view call with .catch() emits STATIC + CATCH', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const account = 2;
        ERC20.at(addr).balanceOf(account).catch(() => {});
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.STATIC);
    expect(bytes).toContain(OPS.CATCH);

    // CATCH must follow the STATIC call's operands
    const catchIdx = bytes.indexOf(OPS.CATCH);
    expect(catchIdx).toBeGreaterThan(bytes.indexOf(OPS.STATIC));
  });

  it('handler code is embedded after CATCH length byte', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.at(addr).transfer(to, amount).catch(() => {
          const failed = 1;
        });
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    // handler = WRITE_VALUE, 3, BYTE_1, 1 → 4 bytes
    const catchIdx = bytes.indexOf(OPS.CATCH);
    expect(bytes[catchIdx + 1]).toBe(4);
    expect(bytes[catchIdx + 2]).toBe(OPS.WRITE_VALUE);
    expect(bytes[catchIdx + 3]).toBe(3); // slot 3
    expect(bytes[catchIdx + 4]).toBe(OPS.BYTE_1);
    expect(bytes[catchIdx + 5]).toBe(1);
  });

  it('code after .catch() is emitted', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.at(addr).transfer(to, amount).catch(() => {});
        const result = 42;
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    const catchIdx = bytes.indexOf(OPS.CATCH);
    expect(bytes[catchIdx + 1]).toBe(0); // empty handler
    // Code after: WRITE_VALUE slot BYTE_1 42
    expect(bytes[catchIdx + 2]).toBe(OPS.WRITE_VALUE);
    expect(bytes[catchIdx + 3]).toBe(3);
    expect(bytes[catchIdx + 4]).toBe(OPS.BYTE_1);
    expect(bytes[catchIdx + 5]).toBe(42);
  });

  it('variable-bound contract with .catch()', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        const token = ERC20.at(addr);
        token.transfer(to, amount).catch(() => {});
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.CALL);
    expect(bytes).toContain(OPS.CATCH);
    // CATCH with empty handler
    const catchIdx = bytes.indexOf(OPS.CATCH);
    expect(bytes[catchIdx + 1]).toBe(0);
  });

  it('view binding with .catch() uses STATIC', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const account = 2;
        const token = ERC20.view(addr);
        token.balanceOf(account).catch(() => {});
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.STATIC);
    expect(bytes).toContain(OPS.CATCH);
  });

  it('multiple statements in catch handler', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.at(addr).transfer(to, amount).catch(() => {
          const a = 10;
          const b = 20;
        });
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    const catchIdx = bytes.indexOf(OPS.CATCH);
    // handler = WRITE_VALUE 3 BYTE_1 10 + WRITE_VALUE 4 BYTE_1 20 = 8 bytes
    expect(bytes[catchIdx + 1]).toBe(8);
  });

  it('.catch() followed by return', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        let result = 0;
        ERC20.at(addr).transfer(to, amount).catch(() => {
          result = 1;
        });
        return result;
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    // Should end with READ_VALUE slot STOP
    const len = bytes.length;
    expect(bytes[len - 1]).toBe(OPS.STOP);
    expect(bytes[len - 3]).toBe(OPS.READ_VALUE);
  });

  it('no JUMP needed in simple layout', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.at(addr).transfer(to, amount).catch(() => {
          const failed = 1;
        });
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    const catchIdx = bytes.indexOf(OPS.CATCH);
    // handler = WRITE_VALUE 3 BYTE_1 1 = 4 bytes
    expect(bytes[catchIdx + 1]).toBe(4);
    expect(bytes[catchIdx + 2]).toBe(OPS.WRITE_VALUE);
    // No JUMP opcode should follow the handler
    expect(bytes[catchIdx + 6]).not.toBe(OPS.JUMP);
  });
});

describe('.catch() errors', () => {
  it('throws when catch handler exceeds 255 bytes', () => {
    // Generate a handler with many variable declarations to exceed 255 bytes
    // Each "const xN = N;" compiles to WRITE_VALUE slot BYTE_1 N = 4 bytes
    const declarations = Array.from({ length: 65 }, (_, i) => `const x${i} = ${i + 1};`).join('\n');
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.at(addr).transfer(to, amount).catch(() => {
          ${declarations}
        });
      }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir] })).toThrow('catch handler too large');
  });

  it('throws when .catch() handler has multiple parameters', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        ERC20.at(addr).transfer(addr, addr).catch((a, b) => {});
      }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir] })).toThrow('catch handler takes at most one parameter');
  });
});

describe('.catch(e) with parameter', () => {
  it('catch(e) wraps CALL with WRITE_HEAP to capture return/revert data', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.at(addr).transfer(to, amount).catch((e) => {
          const x = 1;
        });
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    // WRITE_HEAP should wrap the CALL (appears before CALL in bytecodes)
    expect(bytes).toContain(OPS.WRITE_HEAP);
    expect(bytes).toContain(OPS.CALL);
    expect(bytes).toContain(OPS.CATCH);

    const writeHeapIdx = bytes.indexOf(OPS.WRITE_HEAP);
    const callIdx = bytes.indexOf(OPS.CALL);
    const catchIdx = bytes.indexOf(OPS.CATCH);

    // WRITE_HEAP comes before CALL, CALL comes before CATCH
    expect(writeHeapIdx).toBeLessThan(callIdx);
    expect(callIdx).toBeLessThan(catchIdx);

    // ALLOCATE_HEAP should be present (for the 'e' parameter)
    expect(bytes).toContain(OPS.ALLOCATE_HEAP);
  });

  it('catch(e) with empty handler still wraps CALL', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        ERC20.at(addr).transfer(addr, addr).catch((e) => {});
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.WRITE_HEAP);
    expect(bytes).toContain(OPS.ALLOCATE_HEAP);
  });

  it('variable-bound contract with catch(e)', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const token = ERC20.at(addr);
        token.transfer(addr, addr).catch((e) => {
          const x = 1;
        });
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.WRITE_HEAP);
    expect(bytes).toContain(OPS.CALL);
    expect(bytes).toContain(OPS.CATCH);
    expect(bytes).toContain(OPS.ALLOCATE_HEAP);
  });

  it('view binding with catch(e) uses STATIC', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const token = ERC20.view(addr);
        token.balanceOf(addr).catch((e) => {});
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.WRITE_HEAP);
    expect(bytes).toContain(OPS.STATIC);
    expect(bytes).toContain(OPS.CATCH);
  });

  it('throws on non-identifier catch parameter', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        ERC20.at(addr).transfer(addr, addr).catch(({x}) => {});
      }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir] })).toThrow('catch parameter must be an identifier');
  });
});
