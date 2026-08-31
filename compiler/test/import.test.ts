import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/ops.js';
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-import-test-'));
  fs.writeFileSync(path.join(tmpDir, 'ERC20.json'), JSON.stringify({ abi: erc20Abi }));
  fs.writeFileSync(path.join(tmpDir, 'NoAbi.json'), JSON.stringify({ bytecode: '0x1234' }));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('imports', () => {
  const returnOne = new Uint8Array([OPS.BYTE_1, 1, 0]);

  it('named import resolves and registers contract', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() { return 1; }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode).toEqual([returnOne]);
  });

  it('aliased import registers under local name', () => {
    const source = `
      import { ERC20 as Token } from "./ERC20.json";
      function main() { return 1; }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode).toEqual([returnOne]);
  });

  it('default import registers contract type', () => {
    const source = `
      import ERC20 from "./ERC20.json";
      function main() { return 1; }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode).toEqual([returnOne]);
  });

  it('throws when import does not contain an ABI', () => {
    const source = `
      import { MyContract } from "./NoAbi.json";
      function main() { return 1; }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir] })).toThrow('does not contain an ABI');
  });

  it('throws when no baseDirs provided', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() { return 1; }
    `;

    expect(() => compile(source)).toThrow('Cannot resolve import');
  });

  it('dedups re-importing an IDENTICAL contract ABI under the same name', () => {
    // Registering ERC20 with the SAME abi via the contracts option AND a `.json` import
    // is idempotent — a no-op, not a throw — so a shared ABI pulled through multiple
    // import paths (e.g. two source modules both importing it) does not collide.
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() { return 1; }
    `;

    const result = compile(source, {
      baseDirs: [tmpDir],
      contracts: { ERC20: { abi: erc20Abi } },
    });

    expect(result.bytecode).toEqual([returnOne]);
  });

  it('throws on CONFLICTING ABIs for the same local name', () => {
    // A DIFFERENT abi under an already-registered local name is a real collision, not a
    // dedup: silently keeping the first would compile later calls against the wrong
    // selector. The import (full erc20Abi) conflicts with the minimal contracts-option abi.
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() { return 1; }
    `;

    expect(() =>
      compile(source, {
        baseDirs: [tmpDir],
        contracts: {
          ERC20: {
            abi: [{ type: 'function' as const, name: 'transfer', inputs: [] }],
          },
        },
      }),
    ).toThrow('Conflicting ABIs');
  });

  it('import and function declarations coexist', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";

      function add(a, b) { return a + b; }

      function main() {
        const x = add(1, 2);
        return x;
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode).toEqual([
      // add(a, b) { return a + b; }
      new Uint8Array([OPS.ALLOCATE_VALUE, 2, OPS.ADD, OPS.READ_VALUE, 0, OPS.READ_VALUE, 1, 0]),
      // main() { const x = add(1, 2); return x; }
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.CALL_FUNCTION,
        0,
        2,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        2,
        OPS.READ_VALUE,
        0,
        0,
      ]),
    ]);
  });

  it('resolves from second baseDir when first does not have the file', () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-import-test2-'));
    fs.writeFileSync(path.join(otherDir, 'Token.json'), JSON.stringify({ abi: erc20Abi }));

    const source = `
      import { Token } from "./Token.json";
      function main() { return 1; }
    `;

    const result = compile(source, { baseDirs: [tmpDir, otherDir] });

    expect(result.bytecode).toEqual([returnOne]);

    fs.rmSync(otherDir, { recursive: true, force: true });
  });

  it('pre-registered contracts via options work', () => {
    const source = `
      function main() { return 1; }
    `;

    const result = compile(source, {
      contracts: {
        ERC20: {
          abi: [
            {
              type: 'function' as const,
              name: 'transfer',
              inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' },
              ],
            },
          ],
        },
      },
    });

    expect(result.bytecode).toEqual([returnOne]);
  });
});

describe('contract calls', () => {
  // transfer(address,uint256) selector
  const transferSelector = [0xa9, 0x05, 0x9c, 0xbb];
  // balanceOf(address) selector
  const balanceOfSelector = [0x70, 0xa0, 0x82, 0x31];
  // totalSupply() selector
  const totalSupplySelector = [0x18, 0x16, 0x0d, 0xdd];

  it('inline chain: ERC20.at(addr).transfer(to, amount)', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.at(addr).transfer(to, amount);
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode[0]).toEqual(
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
        OPS.INDEX,
        OPS.BYTE_1,
        0,
        OPS.ABI_DECODE,
        1,
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
        OPS.BYTE_1,
      ]),
    );
  });

  it('inline chain view: ERC20.at(addr).balanceOf(account) auto-detects static call', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const account = 2;
        ERC20.at(addr).balanceOf(account);
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        1,
        OPS.BYTE_1,
        2,
        OPS.INDEX,
        OPS.BYTE_1,
        0,
        OPS.ABI_DECODE,
        1,
        OPS.STATIC,
        OPS.READ_VALUE,
        0,
        OPS.CONCAT,
        2,
        OPS.BYTES,
        4,
        ...balanceOfSelector,
        OPS.ABI_ENCODE,
        OPS.TUPLE,
        1,
        OPS.READ_VALUE,
        1,
        OPS.BYTE_32,
      ]),
    );
  });

  it('standalone binding + variable-bound call: const token = ERC20.at(addr); token.transfer(to, amount)', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        const token = ERC20.at(addr);
        token.transfer(to, amount);
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        4,
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
        OPS.WRITE_VALUE,
        3,
        OPS.READ_VALUE,
        0,
        OPS.INDEX,
        OPS.BYTE_1,
        0,
        OPS.ABI_DECODE,
        1,
        OPS.CALL,
        OPS.READ_VALUE,
        3,
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
        OPS.BYTE_1,
      ]),
    );
  });

  it('view binding forces static call on nonpayable method', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.view(addr).transfer(to, amount);
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode[0]).toEqual(
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
        OPS.INDEX,
        OPS.BYTE_1,
        0,
        OPS.ABI_DECODE,
        1,
        OPS.STATIC,
        OPS.READ_VALUE,
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
        OPS.BYTE_1,
      ]),
    );
  });

  it('lib binding forces delegate call', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        ERC20.lib(addr).transfer(to, amount);
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode[0]).toEqual(
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
        OPS.INDEX,
        OPS.BYTE_1,
        0,
        OPS.ABI_DECODE,
        1,
        OPS.DELEGATE,
        OPS.READ_VALUE,
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
        OPS.BYTE_1,
      ]),
    );
  });

  it('variable-bound view: const token = ERC20.view(addr); token.transfer(to, amount)', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        const amount = 3;
        const token = ERC20.view(addr);
        token.transfer(to, amount);
      }
    `;

    const result = compile(source, { baseDirs: [tmpDir] });

    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        4,
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
        OPS.WRITE_VALUE,
        3,
        OPS.READ_VALUE,
        0,
        OPS.INDEX,
        OPS.BYTE_1,
        0,
        OPS.ABI_DECODE,
        1,
        OPS.STATIC,
        OPS.READ_VALUE,
        3,
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
        OPS.BYTE_1,
      ]),
    );
  });

  it('throws on wrong argument count', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        const to = 2;
        ERC20.at(addr).transfer(to);
      }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir] })).toThrow('expects 2 argument(s), got 1');
  });

  it('throws on unknown method', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const addr = 1;
        ERC20.at(addr).nonexistent();
      }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir] })).toThrow('Unknown method "nonexistent"');
  });

  it('bare ERC20.transfer() without .at() throws', () => {
    const source = `
      import { ERC20 } from "./ERC20.json";
      function main() {
        const to = 1;
        const amount = 2;
        ERC20.transfer(to, amount);
      }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir] })).toThrow('undefined variable: ERC20');
  });

  it('no-arg method produces selector-only calldata', () => {
    const noArgAbi = [
      {
        type: 'function' as const,
        name: 'totalSupply',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view' as const,
      },
    ];

    const noArgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-noarg-test-'));
    fs.writeFileSync(path.join(noArgDir, 'Token.json'), JSON.stringify({ abi: noArgAbi }));

    const source = `
      import { Token } from "./Token.json";
      function main() {
        const addr = 1;
        Token.at(addr).totalSupply();
      }
    `;

    const result = compile(source, { baseDirs: [noArgDir] });

    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.INDEX,
        OPS.BYTE_1,
        0,
        OPS.ABI_DECODE,
        1,
        OPS.STATIC,
        OPS.READ_VALUE,
        0,
        OPS.BYTES,
        4,
        ...totalSupplySelector,
        OPS.BYTE_32,
      ]),
    );

    fs.rmSync(noArgDir, { recursive: true, force: true });
  });
});
