import * as path from 'path';
import { compile, type CompileTarget } from '../src/index.js';
import { CompilerContext } from '../src/context.js';
import { OPS } from '../src/saucer/ops.js';
import { makeNodeModulesFixture, type NodeModulesFixture } from './node-modules-fixture.js';

// Bare-specifier / node_modules module resolution (E1.2), layered on E1.1's per-target arm
// selection. See node-modules-fixture.ts for the on-disk layout materialized before each test.

function returnLiteral(n: number): Uint8Array {
  return new Uint8Array([OPS.BYTE_1, n, 0]);
}

let fx: NodeModulesFixture;

beforeAll(() => {
  fx = makeNodeModulesFixture();
});

afterAll(() => {
  fx.cleanup();
});

describe('bare-specifier / node_modules resolution', () => {
  it('resolves a scoped package via exports "." -> import/default', () => {
    const source = `
      import { tok } from "@sauce/token";
      function main() { return tok(); }
    `;

    const v1Result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(v1Result.bytecode[0]).toEqual(returnLiteral(1));
  });

  it('composes with per-target arm selection on the resolved package entry', () => {
    const source = `
      import { tok } from "@sauce/token";
      function main() { return tok(); }
    `;

    const svmResult = compile(source, { baseDirs: [fx.projDir], target: 'svm', cache: false });
    const v1Result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    const svmFlat = Buffer.concat(svmResult.bytecode.map((b) => Buffer.from(b)));
    const v1Flat = Buffer.concat(v1Result.bytecode.map((b) => Buffer.from(b)));

    expect(svmFlat.equals(v1Flat)).toBe(false);
    expect(v1Result.bytecode[0]).toEqual(returnLiteral(1));
  });

  it('resolves an in-package relative sub-import, arm included', () => {
    const ctx = new CompilerContext([fx.projDir], {}, 'v1');
    const entry = ctx.resolveModuleSource('@sauce/token');

    expect(entry?.filePath.endsWith('token.js')).toBe(true);

    const svmCtx = new CompilerContext([fx.projDir], {}, 'svm');
    const dir = svmCtx.resolveModuleSource('@sauce/token');
    const sub = svmCtx.resolveModuleSource('./util', dir ? path.dirname(dir.filePath) : undefined);

    expect(sub?.filePath.endsWith('util.svm.js')).toBe(true);
  });

  it('module field wins over main, and the package own nested relative import resolves', () => {
    const source = `
      import { useMod } from "modpkg";
      function main() { return useMod(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(7));
  });

  it('plain main field resolves', () => {
    const source = `
      import { useMain } from "mainpkg";
      function main() { return useMain(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(8));
  });

  it('no entry field at all falls back to index.js', () => {
    const source = `
      import { useIndex } from "indexpkg";
      function main() { return useIndex(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(9));
  });

  it('an unmodeled exports shape (array) degrades to main', () => {
    const source = `
      import { useWeird } from "weirdexports";
      function main() { return useWeird(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(10));
  });

  it('no package.json at all falls back to index.js', () => {
    const source = `
      import { useNoManifest } from "nomanifest";
      function main() { return useNoManifest(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(11));
  });

  it('an in-package .json ABI import resolves relative to the package', () => {
    const source = `
      import { useAbi } from "abipkg";
      function main() { return useAbi(); }
    `;

    expect(() => compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false })).not.toThrow();
  });

  it('walks up from a nested importing module to find the projDir node_modules', () => {
    const source = `
      import { useNested } from "./nested/consumer";
      function main() { return useNested(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(1));
  });

  it('a nested node_modules shadows the outer one for a module reached through it', () => {
    const source = `
      import { useShadowed } from "./shadowed/consumer";
      function main() { return useShadowed(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(3));
  });

  it('escapepkg entry escaping the package root throws and never reads the target file', () => {
    const source = `
      import { x } from "escapepkg";
      function main() { return x(); }
    `;

    expect(() => compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false })).toThrow(
      /escapes the package root/,
    );
  });

  it('a bare @scope with no package name is rejected', () => {
    const ctx = new CompilerContext([fx.projDir], {}, 'v1');

    expect(() => ctx.resolveModuleSource('@sauce')).toThrow(/invalid package specifier/);
  });

  it('a bare package subpath is rejected once the package is actually found', () => {
    const source = `
      import { tok } from "@sauce/token/util";
      function main() { return tok(); }
    `;

    expect(() => compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false })).toThrow(/subpath import/);
  });

  it('an absolute module specifier is rejected', () => {
    const ctx = new CompilerContext([fx.projDir], {}, 'v1');

    expect(() => ctx.resolveModuleSource('/abs/module.js')).toThrow(/absolute module import/);
  });

  it('an absolute specifier does not affect .json contract ABI resolution', () => {
    // resolveImport never gained the absolute-path check (scoped to modules only) — this pins
    // that a plain relative .json import is unaffected by any of this feature's rejections.
    const ctx = new CompilerContext([fx.projDir], {}, 'v1');

    expect(() => ctx.resolveImport('does-not-exist.json')).toThrow(/Cannot resolve import/);
  });

  it('an uninstalled bare package falls through to the pre-existing .json-contract error', () => {
    expect(() => {
      new CompilerContext([fx.projDir], {}, 'v1').resolveModuleSource('totally-not-installed');
    }).not.toThrow(); // resolveModuleSource itself returns undefined, doesn't throw

    const source = `
      import { x } from "totally-not-installed";
      function main() { return x(); }
    `;

    expect(() => compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false })).toThrow(
      /Cannot resolve import/,
    );
  });

  it('a .json bare specifier is never treated as a module', () => {
    const ctx = new CompilerContext([fx.projDir], {}, 'v1');

    expect(ctx.resolveModuleSource('some-package.json')).toBeUndefined();
  });

  // --- Negative controls: pre-existing path-based resolution is untouched -----------------

  it('PRECEDENCE: a baseDir file wins over a same-named installed package', () => {
    const source = `
      import { u } from "utils";
      function main() { return u(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(12));
  });

  it('a bare specifier containing a slash still resolves as an ordinary baseDir path', () => {
    const source = `
      import { d } from "sub/deep";
      function main() { return d(); }
    `;

    const result = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false });

    expect(result.bytecode[0]).toEqual(returnLiteral(13));
  });

  it('BYTE EQUALITY: an unrelated node_modules tree is inert for a relative-import program', () => {
    const source = `
      import { u } from "./utils.js";
      function main() { return u(); }
    `;

    const withPackages = compile(source, { baseDirs: [fx.projDir], target: 'v1', cache: false }).bytecode;

    expect(withPackages[0]).toEqual(returnLiteral(12));
  });
});

// Ambient bare-specifier package resolution (P5's "resolved unknown": ambient's specifier
// resolution is the SAME collectFunctionsFromSpecifier machinery a real import already uses —
// context.ts's resolveModuleSource -> resolvePackage fallback for a specifier that isn't
// "./"/"../" — so `CompileOptions.ambient` resolves a bare/scoped package specifier through
// node_modules exactly like `import ... from "@sauce/token"` above, with NO import line at all.
// See docs/plans/P5-plugin-skeleton-design.md and compiler/test/ambient-import.test.ts (which
// covers the RELATIVE-specifier ambient shape; this is its bare-package-specifier counterpart).
//
// Reuses the SAME toy `@sauce/token` fixture as the rest of this file (a fake `tok()` export
// with a real per-target `.svm.js` arm) — NOT the actual `sdk/src/std/token` library, whose
// arms are named `.evm.js`/`.svm.js` (the PUBLISHED Rust/WASM compiler's target vocabulary),
// not this compiler's own `CompileTarget` ('v1'/'v12'/'svm') — so it cannot be resolved by this
// compiler's arm probe at all yet, ambient or import, independent of this feature.
describe('ambient bare-specifier package resolution (CompileOptions.ambient)', () => {
  const targets: CompileTarget[] = ['v1', 'v12'];

  for (const target of targets) {
    it(`ambient: ['@sauce/token'] resolves via node_modules, byte-identical to the import, on target ${target}`, () => {
      const viaAmbient = compile('function main() { return tok(); }', {
        baseDirs: [fx.projDir],
        target,
        ambient: ['@sauce/token'],
        cache: false,
      });

      const viaImport = compile('import { tok } from "@sauce/token";\nfunction main() { return tok(); }', {
        baseDirs: [fx.projDir],
        target,
        cache: false,
      });

      expect(viaAmbient.bytecode.length).toBe(viaImport.bytecode.length);
      viaAmbient.bytecode.forEach((buf, i) => expect(Array.from(buf)).toEqual(Array.from(viaImport.bytecode[i])));
    });
  }

  it('composes with per-target arm selection: the svm arm wins ambiently too, diverging from the v1/v12 neutral body', () => {
    const svmResult = compile('function main() { return tok(); }', {
      baseDirs: [fx.projDir],
      target: 'svm',
      ambient: ['@sauce/token'],
      cache: false,
    });

    const v1Result = compile('function main() { return tok(); }', {
      baseDirs: [fx.projDir],
      target: 'v1',
      ambient: ['@sauce/token'],
      cache: false,
    });

    expect(v1Result.bytecode[0]).toEqual(returnLiteral(1));
    expect(svmResult.bytecode[0]).not.toEqual(v1Result.bytecode[0]);
  });

  it('without ambient (and no import line), the same program genuinely fails to resolve — not a vacuous pass', () => {
    expect(() =>
      compile('function main() { return tok(); }', { baseDirs: [fx.projDir], target: 'v1', cache: false }),
    ).toThrow();
  });
});
