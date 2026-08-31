import { compile, type CompileTarget } from '../src/index.js';
import { CompilerContext } from '../src/context.js';
import { OPS } from '../src/saucer/ops.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Per-target "arm" import resolution: `resolveModuleSource` probes a sibling
// `<base>.<target>.<ext>` file BEFORE the neutral module, so a same import specifier can
// compile to different bytecode per target. Modules are written as PLAIN JS (no
// transformModule needed unless a test specifically exercises the .ts front-end).

let tmpDir: string;

function writeMod(name: string, code: string): void {
  fs.writeFileSync(path.join(tmpDir, name), code);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-target-arm-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A v1 `return N;` (N a one-byte literal) compiles to [BYTE_1, N, 0] — see test/import.test.ts.
function returnLiteral(n: number): Uint8Array {
  return new Uint8Array([OPS.BYTE_1, n, 0]);
}

describe('per-target arm import resolution', () => {
  it('A: an arm matching the compile target is selected over the neutral module', () => {
    writeMod('ta_pick.js', `export function pick(){ return 1n; }`);
    writeMod('ta_pick.svm.js', `export function pick(){ return 2n; }`);
    const source = `
      import { pick } from "./ta_pick";
      function main() { return pick(); }
    `;

    const svmResult = compile(source, { baseDirs: [tmpDir], target: 'svm', cache: false });
    const v1Result = compile(source, { baseDirs: [tmpDir], target: 'v1', cache: false });
    const v12Result = compile(source, { baseDirs: [tmpDir], target: 'v12', cache: false });

    // On v1, an imported function gets its own body in the function table (index 0,
    // preceding main which CALL_FUNCTIONs into it) — assert its body directly.
    expect(v1Result.bytecode.length).toBe(2);
    expect(v1Result.bytecode[0]).toEqual(returnLiteral(1));
    expect(v12Result.bytecode.length).toBeGreaterThan(0);
    expect(svmResult.bytecode.length).toBeGreaterThan(0);

    // The svm-arm program must differ from the v1/v12 (neutral) program.
    const svmFlat = Buffer.concat(svmResult.bytecode.map((b) => Buffer.from(b)));
    const neutralFlat = Buffer.concat(v1Result.bytecode.map((b) => Buffer.from(b)));

    expect(svmFlat.equals(neutralFlat)).toBe(false);
  });

  it('B: the unselected arm is never parsed (deliberately unparseable)', () => {
    // Only the .svm arm is broken; v1/v12 must never even attempt to read/parse it.
    writeMod('ta_broken.js', `export function ok(){ return 3n; }`);
    writeMod('ta_broken.svm.js', `export function ok( {{{ not valid js at all`);
    const source = `
      import { ok } from "./ta_broken";
      function main() { return ok(); }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir], target: 'v1', cache: false })).not.toThrow();
    expect(() => compile(source, { baseDirs: [tmpDir], target: 'v12', cache: false })).not.toThrow();

    // Mirror: a broken NEUTRAL file with a valid arm must compile fine under the matching target.
    writeMod('ta_broken2.js', `export function ok2( {{{ not valid js at all`);
    writeMod('ta_broken2.svm.js', `export function ok2(){ return 4n; }`);
    const source2 = `
      import { ok2 } from "./ta_broken2";
      function main() { return ok2(); }
    `;

    expect(() => compile(source2, { baseDirs: [tmpDir], target: 'svm', cache: false })).not.toThrow();
  });

  it('C: an explicit-extension specifier probes its own extension arm first', () => {
    writeMod('ta_ext.js', `export function extFn(){ return 5n; }`);
    writeMod('ta_ext.svm.js', `export function extFn(){ return 6n; }`);
    const source = `
      import { extFn } from "./ta_ext.js";
      function main() { return extFn(); }
    `;

    const v1Result = compile(source, { baseDirs: [tmpDir], target: 'v1', cache: false });
    const svmResult = compile(source, { baseDirs: [tmpDir], target: 'svm', cache: false });

    expect(v1Result.bytecode.length).toBe(2);
    expect(v1Result.bytecode[0]).toEqual(returnLiteral(5));
    expect(svmResult.bytecode.length).toBeGreaterThan(0);
  });

  it('D: falls back across arm extensions and drives the .ts front-end via the arm filePath', () => {
    writeMod('ta_fb.js', `export function fb(){ return 7n; }`);
    // Type annotation only parses if the built-in ts-frontend actually runs on this arm.
    writeMod('ta_fb.svm.ts', `export function fb(): bigint { return 8n; }`);
    const source = `
      import { fb } from "./ta_fb.js";
      function main() { return fb(); }
    `;

    const result = compile(source, { baseDirs: [tmpDir], target: 'svm', cache: false });

    expect(result.bytecode.length).toBeGreaterThan(0);
  });

  it('E: three targets each select their own distinct arm; v1 falls to neutral without one', () => {
    writeMod('ta_three.js', `export function three(){ return 1n; }`);
    writeMod('ta_three.v12.js', `export function three(){ return 12n; }`);
    writeMod('ta_three.svm.js', `export function three(){ return 2n; }`);
    const source = `
      import { three } from "./ta_three";
      function main() { return three(); }
    `;

    const v1Result = compile(source, { baseDirs: [tmpDir], target: 'v1', cache: false });
    const v12Result = compile(source, { baseDirs: [tmpDir], target: 'v12', cache: false });
    const svmResult = compile(source, { baseDirs: [tmpDir], target: 'svm', cache: false });

    // v1 has no .v1 arm here -> neutral (1n).
    expect(v1Result.bytecode.length).toBe(2);
    expect(v1Result.bytecode[0]).toEqual(returnLiteral(1));
    expect(v12Result.bytecode.length).toBeGreaterThan(0);
    expect(svmResult.bytecode.length).toBeGreaterThan(0);

    // Now add a .v1 arm and confirm v1 picks it up too.
    writeMod('ta_three.v1.js', `export function three(){ return 9n; }`);
    const v1WithArm = compile(source, { baseDirs: [tmpDir], target: 'v1', cache: false });

    expect(v1WithArm.bytecode[0]).toEqual(returnLiteral(9));
  });

  it('F: a .json ABI import is NOT arm-selected', () => {
    // (svm rejects ABI-typed contract bindings outright regardless of arm-selection, so this
    // is exercised on v12 — the arm-selection question is orthogonal to that unrelated guard.)
    const fooAbi = [
      { type: 'function' as const, name: 'foo', inputs: [], outputs: [], stateMutability: 'view' as const },
    ];
    const barAbi = [
      { type: 'function' as const, name: 'bar', inputs: [], outputs: [], stateMutability: 'view' as const },
    ];
    fs.writeFileSync(path.join(tmpDir, 'TaAbi.json'), JSON.stringify({ abi: fooAbi }));
    fs.writeFileSync(path.join(tmpDir, 'TaAbi.v12.json'), JSON.stringify({ abi: barAbi }));

    const fooSource = `
      import { TaAbi } from "./TaAbi.json";
      function main() { const addr = 1; TaAbi.at(addr).foo(); return 1; }
    `;
    const barSource = `
      import { TaAbi } from "./TaAbi.json";
      function main() { const addr = 1; TaAbi.at(addr).bar(); return 1; }
    `;

    // The NEUTRAL abi (foo) is what gets registered, even under target v12.
    expect(() => compile(fooSource, { baseDirs: [tmpDir], target: 'v12', cache: false })).not.toThrow();
    expect(() => compile(barSource, { baseDirs: [tmpDir], target: 'v12', cache: false })).toThrow();
  });

  it('G: resolveModuleSource dedup key is the neutral path; direct API assertions', () => {
    writeMod('ta_key.js', `export function keyFn(){ return 1n; }`);
    writeMod('ta_key.svm.js', `export function keyFn(){ return 2n; }`);

    const svmCtx = new CompilerContext([tmpDir], {}, 'svm');
    const armResolved = svmCtx.resolveModuleSource('./ta_key');

    expect(armResolved?.filePath.endsWith('ta_key.svm.js')).toBe(true);
    expect(armResolved?.dedupKey?.endsWith('ta_key.js')).toBe(true);
    expect(armResolved?.dedupKey?.endsWith('.svm.js')).toBe(false);

    writeMod('ta_neutralonly.js', `export function neutralOnly(){ return 1n; }`);
    const neutralResolved = svmCtx.resolveModuleSource('./ta_neutralonly');

    expect(neutralResolved?.dedupKey).toBeUndefined();

    // Behavioral half: a shared arm-selected module imported by two parents, AND directly
    // by main, is pulled exactly once (no duplicate-imported-function error).
    writeMod('ta_shared.js', `export function shared(){ return 1n; }`);
    writeMod('ta_shared.svm.js', `export function shared(){ return 2n; }`);
    writeMod('ta_p1.js', `import { shared } from "./ta_shared";\nexport function p1(){ return shared() + 1n; }`);
    writeMod('ta_p2.js', `import { shared } from "./ta_shared";\nexport function p2(){ return shared() + 2n; }`);
    const source = `
      import { p1 } from "./ta_p1";
      import { p2 } from "./ta_p2";
      import { shared } from "./ta_shared";
      function main() { return p1() + p2() + shared(); }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir], target: 'svm', cache: false })).not.toThrow();
  });

  it('H: an arm-only module (no neutral file) resolves under the matching target only', () => {
    writeMod('ta_armonly.svm.js', `export function armOnly(){ return 1n; }`);
    const source = `
      import { armOnly } from "./ta_armonly";
      function main() { return armOnly(); }
    `;

    expect(() => compile(source, { baseDirs: [tmpDir], target: 'svm', cache: false })).not.toThrow();
    // Under v1 there's no arm and no neutral file -> falls through to the .json-contract
    // path, which fails resolving a contract ABI from a non-existent/invalid JSON.
    expect(() => compile(source, { baseDirs: [tmpDir], target: 'v1', cache: false })).toThrow();
  });

  it('I: a direct arm-path import is treated as an ordinary module (not rejected)', () => {
    writeMod('ta_direct.svm.js', `export function directPick(){ return 1n; }`);
    const source = `
      import { directPick } from "./ta_direct.svm.js";
      function main() { return directPick(); }
    `;

    for (const target of ['v1', 'v12', 'svm'] as CompileTarget[]) {
      expect(() => compile(source, { baseDirs: [tmpDir], target, cache: false })).not.toThrow();
    }

    // Importing the SAME physical arm file both directly (by its own arm-tagged path) and
    // indirectly (via the neutral specifier, which resolves to that same arm file under the
    // matching target) resolves to the identical `filePath`, so it is correctly deduped —
    // no "duplicate imported function" error, and both of its functions remain callable.
    writeMod('ta_dup.js', `export function dupA(){ return 1n; } export function dupB(){ return 2n; }`);
    writeMod('ta_dup.svm.js', `export function dupA(){ return 10n; } export function dupB(){ return 20n; }`);
    const dupSource = `
      import { dupA } from "./ta_dup";
      import { dupB } from "./ta_dup.svm.js";
      function main() { return dupA() + dupB(); }
    `;

    expect(() => compile(dupSource, { baseDirs: [tmpDir], target: 'svm', cache: false })).not.toThrow();
  });

  it('J: back-compat — neutral-only module unaffected on all targets, arm code path inert', () => {
    writeMod('ta_ctl.js', `export function ctl(){ return 1n; }`);
    const source = `
      import { ctl } from "./ta_ctl";
      function main() { return ctl(); }
    `;

    for (const target of ['v1', 'v12', 'svm'] as CompileTarget[]) {
      expect(() => compile(source, { baseDirs: [tmpDir], target, cache: false })).not.toThrow();
    }

    const before = compile(source, { baseDirs: [tmpDir], target: 'v1', cache: false }).bytecode;

    // Adding an arm for a DIFFERENT (non-matching) target must not change v1's output at all.
    writeMod('ta_ctl.v12.js', `export function ctl(){ return 99n; }`);

    const after = compile(source, { baseDirs: [tmpDir], target: 'v1', cache: false }).bytecode;

    expect(after).toEqual(before);
  });

  it('K: baseDir precedence — an earlier baseDir neutral beats a later baseDir arm', () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-target-arm-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-target-arm-b-'));

    try {
      fs.writeFileSync(path.join(dirA, 'ta_prec.js'), `export function prec(){ return 1n; }`);
      fs.writeFileSync(path.join(dirB, 'ta_prec.svm.js'), `export function prec(){ return 2n; }`);

      const source = `
        import { prec } from "./ta_prec";
        function main() { return prec(); }
      `;

      const result = compile(source, { baseDirs: [dirA, dirB], target: 'svm', cache: false });

      expect(result.bytecode.length).toBeGreaterThan(0);

      const ctx = new CompilerContext([dirA, dirB], {}, 'svm');
      const resolved = ctx.resolveModuleSource('./ta_prec');

      expect(resolved?.filePath.startsWith(dirA)).toBe(true);
      expect(resolved?.filePath.endsWith('.svm.js')).toBe(false);
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
});
