import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/ops.js';

// The four import FORMS, locked against compiler-rs's own behavior:
//   1. a `.json` ABI as a bare top-level ARRAY as well as a build-tool artifact OBJECT
//   2. several bindings in one import (a SOURCE module binds N; a `.json` contract binds one)
//   3. type-only import erasure (declaration-level, and an inline `type` specifier)
//   4. a relative specifier climbing ABOVE the project root is rejected, not silently read

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
];

let outerDir: string;
let projDir: string;
let subDir: string;

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

beforeAll(() => {
  // The project root is `projDir`; `outerDir` is its parent, holding the files an escaping
  // specifier would reach. They really exist, so a passing escape test proves the specifier was
  // rejected on its own shape rather than merely failing to find anything.
  outerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-import-forms-'));
  projDir = path.join(outerDir, 'proj');
  subDir = path.join(projDir, 'sub');

  write(path.join(projDir, 'BareAbi.json'), JSON.stringify(erc20Abi));
  write(
    path.join(projDir, 'Artifact.json'),
    JSON.stringify({ contractName: 'ERC20', abi: erc20Abi, bytecode: '0x60' }),
  );
  write(path.join(projDir, 'NoAbi.json'), JSON.stringify({ bytecode: '0x60' }));
  write(path.join(projDir, 'AbiNotArray.json'), JSON.stringify({ abi: { transfer: true } }));

  write(path.join(projDir, 'lib.js'), 'export function one() { return 1n; }\nexport function two() { return 2n; }\n');
  write(
    path.join(projDir, 'typed.ts'),
    'export type Amount = bigint;\nexport function three(): bigint { return 3n; }\n',
  );
  write(path.join(projDir, 'shared.js'), 'export function shared() { return 4n; }\n');
  write(
    path.join(subDir, 'uses-parent.js'),
    'import { shared } from "../shared.js";\nexport function viaParent() { return shared(); }\n',
  );
  write(
    path.join(subDir, 'escapes.js'),
    'import { outside } from "../../outside.js";\nexport function bad() { return outside(); }\n',
  );

  write(path.join(outerDir, 'outside.js'), 'export function outside() { return 99n; }\n');
  write(path.join(outerDir, 'Outside.json'), JSON.stringify({ abi: erc20Abi }));
});

afterAll(() => {
  fs.rmSync(outerDir, { recursive: true, force: true });
});

const callTransfer = `
  function main() {
    const addr = 1;
    ERC20.at(addr).transfer(addr, addr);
  }
`;

describe('form 1: a .json ABI import accepts both shipped shapes', () => {
  it('a bare top-level ABI array compiles identically to a build-tool artifact object', () => {
    const bare = compile(`import { ERC20 } from "./BareAbi.json";${callTransfer}`, { baseDirs: [projDir] });
    const artifact = compile(`import { ERC20 } from "./Artifact.json";${callTransfer}`, { baseDirs: [projDir] });

    // Non-vacuous: a real contract call was emitted (a selector-bearing CONCAT), not just a halt.
    expect(bare.bytecode[0].length).toBeGreaterThan(8);
    expect(bare.bytecode).toEqual(artifact.bytecode);
  });

  it('an artifact object keeps its extra fields ignored', () => {
    const result = compile(`import { ERC20 } from "./Artifact.json";\nfunction main() { return 1; }`, {
      baseDirs: [projDir],
    });

    expect(result.bytecode).toEqual([new Uint8Array([OPS.BYTE_1, 1, 0])]);
  });

  it('rejects a .json with neither shape', () => {
    expect(() =>
      compile(`import { ERC20 } from "./NoAbi.json";\nfunction main() { return 1; }`, { baseDirs: [projDir] }),
    ).toThrow('does not contain an ABI');
  });

  it('rejects an `abi` field that is not an entry array', () => {
    expect(() =>
      compile(`import { ERC20 } from "./AbiNotArray.json";\nfunction main() { return 1; }`, { baseDirs: [projDir] }),
    ).toThrow('does not contain an ABI');
  });
});

describe('form 2: several bindings in one import', () => {
  it('a SOURCE module import binds every specifier', () => {
    const result = compile(`import { one, two } from "./lib.js";\nfunction main() { return one() + two(); }`, {
      baseDirs: [projDir],
    });

    // one(), two(), main() — both bindings resolved to real, separately-emitted functions.
    expect(result.bytecode).toHaveLength(3);
  });

  it('a SOURCE module import links by DECLARED name, so an alias does not rebind (documented)', () => {
    // Pinning a real divergence from compiler-rs, which binds per specifier: a source module's
    // functions are pulled into the shared function table under the names they are DECLARED
    // with, and the specifier list is not consulted — so `one as first` leaves `first` unbound.
    // Aliasing a `.json` contract import (a different mechanism) does work; see import.test.ts.
    expect(() =>
      compile(`import { one as first } from "./lib.js";\nfunction main() { return first(); }`, {
        baseDirs: [projDir],
      }),
    ).toThrow('Function first is undefined');
  });

  it('a multi-binding .json CONTRACT import is a clear error (one ABI is one contract)', () => {
    expect(() =>
      compile(`import { ERC20, Other } from "./Artifact.json";\nfunction main() { return 1; }`, {
        baseDirs: [projDir],
      }),
    ).toThrow('binds 2 names; a .json ABI import binds exactly one');
  });

  it('a default + named .json CONTRACT import is the same error', () => {
    expect(() =>
      compile(`import ERC20, { Other } from "./Artifact.json";\nfunction main() { return 1; }`, {
        baseDirs: [projDir],
      }),
    ).toThrow('binds 2 names; a .json ABI import binds exactly one');
  });

  it('a single-binding .json contract import is unaffected', () => {
    const result = compile(`import { ERC20 } from "./Artifact.json";\nfunction main() { return 1; }`, {
      baseDirs: [projDir],
    });

    expect(result.bytecode).toEqual([new Uint8Array([OPS.BYTE_1, 1, 0])]);
  });
});

describe('form 3: type-only import erasure', () => {
  it('erases a declaration-level type-only import', () => {
    const result = compile(`import type { Amount } from "./typed.ts";\nfunction main() { return 1n; }`, {
      baseDirs: [projDir],
      tsSource: true,
    });

    // Erased outright: the module is never linked, so `three()` is not emitted.
    expect(result.bytecode).toEqual([new Uint8Array([OPS.BYTE_1, 1, 0])]);
  });

  it('erases a declaration-level type-only import of a module that does not resolve at all', () => {
    // Proof the import is dropped before resolution rather than resolved-then-ignored.
    const result = compile(`import type { Missing } from "./no-such-module.ts";\nfunction main() { return 1n; }`, {
      baseDirs: [projDir],
      tsSource: true,
    });

    expect(result.bytecode).toEqual([new Uint8Array([OPS.BYTE_1, 1, 0])]);
  });

  it('drops an inline type specifier and keeps the value specifiers', () => {
    const result = compile(`import { type Amount, three } from "./typed.ts";\nfunction main() { return three(); }`, {
      baseDirs: [projDir],
      tsSource: true,
    });

    // three(), main() — the value binding linked, the type binding gone.
    expect(result.bytecode).toHaveLength(2);
  });

  it('erases a type-only import inside an IMPORTED .ts module too (the import seam)', () => {
    write(
      path.join(projDir, 'typed-consumer.ts'),
      'import type { Amount } from "./typed.ts";\nexport function four(): bigint { return 4n; }\n',
    );

    const result = compile(`import { four } from "./typed-consumer.ts";\nfunction main() { return four(); }`, {
      baseDirs: [projDir],
    });

    expect(result.bytecode).toHaveLength(2);
  });
});

describe('form 4: a specifier climbing above the project root is rejected', () => {
  it('rejects an escaping relative MODULE specifier', () => {
    expect(fs.existsSync(path.join(outerDir, 'outside.js'))).toBe(true);
    expect(() =>
      compile(`import { outside } from "../outside.js";\nfunction main() { return outside(); }`, {
        baseDirs: [projDir],
      }),
    ).toThrow('escapes the project root');
  });

  it('rejects an escaping relative .json CONTRACT specifier', () => {
    expect(fs.existsSync(path.join(outerDir, 'Outside.json'))).toBe(true);
    expect(() =>
      compile(`import { ERC20 } from "../Outside.json";\nfunction main() { return 1; }`, { baseDirs: [projDir] }),
    ).toThrow('escapes the project root');
  });

  it('rejects an escaping root-relative (bare) .json specifier', () => {
    expect(() =>
      compile(`import { ERC20 } from "sub/../../Outside.json";\nfunction main() { return 1; }`, {
        baseDirs: [projDir],
      }),
    ).toThrow('escapes the project root');
  });

  it('rejects an escaping specifier inside a TRANSITIVELY imported module', () => {
    expect(() =>
      compile(`import { bad } from "./sub/escapes.js";\nfunction main() { return bad(); }`, { baseDirs: [projDir] }),
    ).toThrow('escapes the project root');
  });

  it('still resolves a ".." that stays INSIDE the root, from a subdirectory module', () => {
    const result = compile(
      `import { viaParent } from "./sub/uses-parent.js";\nfunction main() { return viaParent(); }`,
      {
        baseDirs: [projDir],
      },
    );

    // shared(), viaParent(), main()
    expect(result.bytecode).toHaveLength(3);
  });

  it('still resolves a ".." that folds away within the root', () => {
    const result = compile(`import { shared } from "./sub/../shared.js";\nfunction main() { return shared(); }`, {
      baseDirs: [projDir],
    });

    expect(result.bytecode).toHaveLength(2);
  });

  it('resolves an escaping-looking specifier that lands in ANOTHER granted baseDir', () => {
    // Containment is judged against every granted root, so "../outside.js" is legitimate when
    // the parent directory is itself a baseDir.
    const result = compile(`import { outside } from "../outside.js";\nfunction main() { return outside(); }`, {
      baseDirs: [projDir, outerDir],
    });

    expect(result.bytecode).toHaveLength(2);
  });

  it('leaves the no-baseDirs case reporting plain unresolvability', () => {
    expect(() => compile(`import { ERC20 } from "../Outside.json";\nfunction main() { return 1; }`)).toThrow(
      'Cannot resolve import',
    );
  });
});
