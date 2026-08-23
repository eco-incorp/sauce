import { compile, type CompileTarget, type CompileResult } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Ambient imports (CompileOptions.ambient) — the TypeScript twin of compiler-rs's P3 ambient
// primitive (see docs/plans/rs-P3-ambient-import-design.md and
// docs/plans/ambient-import-chain-scope-design.md §1.3). An ambient module's exported
// functions/consts are broadcast into the compile's global resolution set with NO import line
// anywhere in the source. Modules are written as PLAIN JS (no transformModule needed) into a
// temp dir used as the baseDir, mirroring source-import.test.ts's own fixture convention.

let tmpDir: string;

function writeMod(name: string, code: string): void {
  fs.writeFileSync(path.join(tmpDir, name), code);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-ambient-import-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const targets: CompileTarget[] = ['v1', 'v12'];

function expectSameBytecode(a: CompileResult, b: CompileResult): void {
  expect(a.bytecode.length).toBe(b.bytecode.length);
  a.bytecode.forEach((buf, i) => expect(Array.from(buf)).toEqual(Array.from(b.bytecode[i])));
}

describe('ambient imports (CompileOptions.ambient)', () => {
  for (const target of targets) {
    describe(`target ${target}`, () => {
      it("an ambient module's exported function resolves with NO import line", () => {
        writeMod('amb_double.js', `export function double(x) { return x * 2n; }`);

        const viaAmbient = compile('function main() { return double(21n); }', {
          baseDirs: [tmpDir],
          target,
          ambient: ['./amb_double'],
        });

        // Same mechanism as a real import — collectFunctionsFromSpecifier is shared — so the
        // ambient-resolved program compiles byte-identically to the equivalent real import
        // (this is the strongest correctness proof a unit test can give without the engine:
        // double() was genuinely registered into the function table and called, not merely
        // tolerated as a no-op).
        const viaImport = compile('import { double } from "./amb_double";\nfunction main() { return double(21n); }', {
          baseDirs: [tmpDir],
          target,
        });

        expectSameBytecode(viaAmbient, viaImport);
      });

      it("an ambient module's exported const resolves with NO import line", () => {
        writeMod('amb_fee.js', `export const FEE = 7n;`);

        const viaAmbient = compile('function main() { return FEE; }', {
          baseDirs: [tmpDir],
          target,
          ambient: ['./amb_fee'],
        });

        // The const channel folds to a literal exactly like CompileOptions.defines does —
        // compare against that already-trusted mechanism for a precise correctness check.
        const viaDefines = compile('function main() { return FEE; }', {
          baseDirs: [tmpDir],
          target,
          defines: { FEE: 7n },
        });

        expectSameBytecode(viaAmbient, viaDefines);
      });

      it('a later ambient const may reference an earlier one in the SAME ambient module', () => {
        writeMod('amb_chain.js', `export const BASE = 10n;\nexport const DOUBLED = BASE * 2n;`);

        const viaAmbient = compile('function main() { return DOUBLED; }', {
          baseDirs: [tmpDir],
          target,
          ambient: ['./amb_chain'],
        });

        const viaDefines = compile('function main() { return DOUBLED; }', {
          baseDirs: [tmpDir],
          target,
          defines: { DOUBLED: 20n },
        });

        expectSameBytecode(viaAmbient, viaDefines);
      });

      it('a user top-level function of the same name WINS over an ambient function', () => {
        writeMod('amb_win_fn.js', `export function pick() { return 1n; }`);

        const source = `
          function pick() { return 2n; }
          function main() { return pick(); }
        `;

        const withAmbient = compile(source, { baseDirs: [tmpDir], target, ambient: ['./amb_win_fn'] });
        const withoutAmbient = compile(source, { baseDirs: [tmpDir], target });

        // Byte-identical: the ambient pick() must never even be added to the function table
        // once the user's own pick() already claims the name.
        expectSameBytecode(withAmbient, withoutAmbient);
      });

      it('a user top-level const of the same name WINS over an ambient const', () => {
        writeMod('amb_win_const.js', `export const RATE = 999n;`);

        const source = `
          const RATE = 3n;
          function main() { return RATE; }
        `;

        const withAmbient = compile(source, { baseDirs: [tmpDir], target, ambient: ['./amb_win_const'] });
        const withoutAmbient = compile(source, { baseDirs: [tmpDir], target });

        expectSameBytecode(withAmbient, withoutAmbient);
      });

      it('a function parameter of the same name WINS over an ambient const', () => {
        writeMod('amb_win_param.js', `export const RATE = 999n;`);

        // RATE is a plain helper parameter here (never a top-level const/import), so a read
        // inside useRate() must resolve to the runtime parameter value, never the ambient
        // const's compile-time literal — ctx.getConstant is only consulted when ctx.getVar is
        // undefined (processExpression's Identifier case), so this needs no special-casing at
        // all in the ambient mechanism itself.
        const source = `
          function useRate(RATE) { return RATE; }
          function main() { return useRate(5n); }
        `;

        const withAmbient = compile(source, { baseDirs: [tmpDir], target, ambient: ['./amb_win_param'] });
        const withoutAmbient = compile(source, { baseDirs: [tmpDir], target });

        expectSameBytecode(withAmbient, withoutAmbient);
      });

      it('an ambient module defining main() is rejected', () => {
        writeMod('amb_bad_main.js', `export function main() { return 1n; }`);

        expect(() =>
          compile('function main() { return 1n; }', { baseDirs: [tmpDir], target, ambient: ['./amb_bad_main'] }),
        ).toThrow(/must not define main\(\)/);
      });

      it('two DIFFERENT ambient modules exporting the same FUNCTION name is a compile error', () => {
        writeMod('amb_dup_fn_a.js', `export function shared() { return 1n; }`);
        writeMod('amb_dup_fn_b.js', `export function shared() { return 2n; }`);

        expect(() =>
          compile('function main() { return shared(); }', {
            baseDirs: [tmpDir],
            target,
            ambient: ['./amb_dup_fn_a', './amb_dup_fn_b'],
          }),
        ).toThrow(/duplicate/i);
      });

      it('two DIFFERENT ambient modules exporting the same CONST name is a compile error', () => {
        writeMod('amb_dup_const_a.js', `export const SHARED = 1n;`);
        writeMod('amb_dup_const_b.js', `export const SHARED = 2n;`);

        expect(() =>
          compile('function main() { return SHARED; }', {
            baseDirs: [tmpDir],
            target,
            ambient: ['./amb_dup_const_a', './amb_dup_const_b'],
          }),
        ).toThrow(/duplicate/i);
      });

      it('an ambient specifier that resolves to a .json contract ABI (not a source module) is rejected', () => {
        writeMod('amb_not_a_module.json', JSON.stringify([]));

        expect(() =>
          compile('function main() { return 1n; }', {
            baseDirs: [tmpDir],
            target,
            ambient: ['./amb_not_a_module.json'],
          }),
        ).toThrow(/does not resolve to a source module/);
      });

      it('ambient: [] (or omitted) is byte-identical to today', () => {
        const source = 'function main() { return 1n; }';

        const withEmptyAmbient = compile(source, { baseDirs: [tmpDir], target, ambient: [] });
        const withoutOption = compile(source, { baseDirs: [tmpDir], target });

        expectSameBytecode(withEmptyAmbient, withoutOption);
      });
    });
  }
});
