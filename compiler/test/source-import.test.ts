import { compile, type CompileTarget } from '../src/index.js';
import { OPS } from '../src/saucer/ops.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Source-file function imports + tree-shaking + conditional compilation. Modules are
// written as PLAIN JS (no transformModule needed) into a temp dir used as the baseDir.

let tmpDir: string;

function writeMod(name: string, code: string): void {
  fs.writeFileSync(path.join(tmpDir, name), code);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-source-import-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const targets: CompileTarget[] = ['v1', 'v12'];

// Total emitted bytecode size across the function table (v1 → array of bodies;
// v12 → one blob). A reachability/fold drop shrinks this.
function totalSize(bytecode: Uint8Array[]): number {
  return bytecode.reduce((acc, b) => acc + b.length, 0);
}

describe('source-file function imports', () => {
  for (const target of targets) {
    describe(`target ${target}`, () => {
      it('imports and calls an exported function', () => {
        writeMod('m_addone.js', `export function addOne(n) { return n + 1n; }`);
        const source = `
          import { addOne } from "./m_addone";
          function main() { return addOne(2n); }
        `;

        const result = compile(source, { baseDirs: [tmpDir], target });

        expect(totalSize(result.bytecode)).toBeGreaterThan(0);

        // addOne is in the function table → on v1 a separate body precedes main.
        if (target === 'v1') expect(result.bytecode.length).toBe(2);
      });

      it('resolves nested imports (a imports b, main imports from both via a)', () => {
        // a.js imports b.js — pulling a transitively pulls b into the function table.
        writeMod('m_b.js', `export function bee() { return 7n; }`);
        writeMod('m_a.js', `import { bee } from "./m_b";\nexport function ay() { return 1n; }`);
        const source = `
          import { ay } from "./m_a";
          import { bee } from "./m_b";
          function main() { return ay() + bee(); }
        `;

        const result = compile(source, { baseDirs: [tmpDir], target });

        expect(totalSize(result.bytecode)).toBeGreaterThan(0);

        // both imported functions (ay, bee) + main present on v1 (bee pulled once,
        // despite being reachable via both the nested and the direct import).
        if (target === 'v1') expect(result.bytecode.length).toBe(3);
      });

      it('tree-shaking drops an imported-but-unreferenced function (the default)', () => {
        writeMod('m_pair.js', `export function used() { return 1n; }\nexport function never() { return 999n; }`);
        const source = `
          import { used, never } from "./m_pair";
          function main() { return used(); }
        `;

        const shaken = compile(source, { baseDirs: [tmpDir], target }); // treeshake defaults true
        const full = compile(source, { baseDirs: [tmpDir], target, treeshake: false });

        if (target === 'v1') {
          // used + main, NOT never.
          expect(shaken.bytecode.length).toBe(2);
          expect(full.bytecode.length).toBe(3);
        } else {
          // v12 single blob is strictly smaller once never() is dropped.
          expect(totalSize(shaken.bytecode)).toBeLessThan(totalSize(full.bytecode));
        }
      });

      it('treeshake: false emits every imported function (legacy)', () => {
        writeMod('m_pair2.js', `export function used2() { return 1n; }\nexport function spare2() { return 2n; }`);
        const source = `
          import { used2, spare2 } from "./m_pair2";
          function main() { return used2(); }
        `;

        const result = compile(source, { baseDirs: [tmpDir], target, treeshake: false });

        if (target === 'v1') expect(result.bytecode.length).toBe(3); // used2 + spare2 + main
      });

      it('defines dead-branch + treeshake drops the guarded handler', () => {
        writeMod('m_helper.js', `export function helper() { return 42n; }`);
        const source = `
          import { helper } from "./m_helper";
          function main() {
            if (HAS_X) { return helper(); }
            return 0n;
          }
        `;

        const off = compile(source, { baseDirs: [tmpDir], target, treeshake: true, defines: { HAS_X: false } });
        const on = compile(source, { baseDirs: [tmpDir], target, treeshake: true, defines: { HAS_X: true } });

        if (target === 'v1') {
          expect(off.bytecode.length).toBe(1); // main only — helper dropped, no dangling call
          expect(on.bytecode.length).toBe(2); // helper + main
        } else {
          // helper present only when the branch is live → larger blob.
          expect(totalSize(on.bytecode)).toBeGreaterThan(totalSize(off.bytecode));
        }
      });

      it('defines via top-level const drops the guarded handler', () => {
        writeMod('m_handler.js', `export function handler() { return 5n; }`);
        const source = `
          const HAS_X = false;
          import { handler } from "./m_handler";
          function main() {
            if (HAS_X) { return handler(); }
            return 0n;
          }
        `;

        const result = compile(source, { baseDirs: [tmpDir], target, treeshake: true });

        if (target === 'v1') expect(result.bytecode.length).toBe(1); // main only
      });

      it('duplicate imported function name from different modules throws', () => {
        writeMod('m_dup1.js', `export function clash() { return 1n; }`);
        writeMod('m_dup2.js', `export function clash() { return 2n; }`);
        const source = `
          import { clash } from "./m_dup1";
          import { clash as clash2 } from "./m_dup2";
          function main() { return clash() + clash2(); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).toThrow('duplicate imported function');
      });

      it('imported module defining main() throws', () => {
        writeMod('m_hasmain.js', `export function main() { return 1n; }`);
        const source = `
          import { main as foo } from "./m_hasmain";
          function main() { return 1n; }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).toThrow('must not define main()');
      });

      it('an imported helper may call a sibling imported function', () => {
        // a() calls shared() — both imported. The helper body must see the shared
        // function table (not a fresh empty one) so the sibling call resolves.
        writeMod('m_shared.js', `export function shared() { return 42n; }`);
        writeMod('m_caller.js', `import { shared } from "./m_shared";\nexport function caller() { return shared(); }`);
        const source = `
          import { caller } from "./m_caller";
          function main() { return caller(); }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).not.toThrow();
      });

      it('two modules importing DIFFERENT ABIs under the same local name throws', () => {
        // A silent miscompile otherwise: the first registration would win and the
        // second module's calls would use the wrong selector/calldata.
        writeMod(
          'abiA.json',
          '{"abi":[{"type":"function","name":"foo","inputs":[{"name":"x","type":"uint256"}],"outputs":[]}]}',
        );
        writeMod(
          'abiB.json',
          '{"abi":[{"type":"function","name":"foo","inputs":[{"name":"x","type":"address"}],"outputs":[]}]}',
        );
        writeMod(
          'm_useA.js',
          `import { Tok } from "./abiA.json";\nexport function ua(a, n) { Tok.at(a).foo(n); return 0n; }`,
        );
        writeMod(
          'm_useB.js',
          `import { Tok } from "./abiB.json";\nexport function ub(a, n) { Tok.at(a).foo(n); return 0n; }`,
        );
        const source = `
          import { ua } from "./m_useA";
          import { ub } from "./m_useB";
          function main() { ua(1n, 2n); ub(3n, 4n); return 0n; }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).toThrow('Conflicting ABIs');
      });

      it('two modules importing the SAME ABI under the same local name dedups', () => {
        writeMod(
          'abiSame.json',
          '{"abi":[{"type":"function","name":"foo","inputs":[{"name":"x","type":"uint256"}],"outputs":[]}]}',
        );
        writeMod(
          'm_sa.js',
          `import { Tok } from "./abiSame.json";\nexport function sa(a, n) { Tok.at(a).foo(n); return 0n; }`,
        );
        writeMod(
          'm_sb.js',
          `import { Tok } from "./abiSame.json";\nexport function sb(a, n) { Tok.at(a).foo(n); return 0n; }`,
        );
        const source = `
          import { sa } from "./m_sa";
          import { sb } from "./m_sb";
          function main() { sa(1n, 2n); sb(3n, 4n); return 0n; }
        `;

        expect(() => compile(source, { baseDirs: [tmpDir], target })).not.toThrow();
      });

      it('a define used in a non-folding position emits as a constant literal', () => {
        // A define must behave as a true compile-time constant in arithmetic /
        // partially-folding positions too, not only inside a fully-foldable condition.
        const withDefine = compile(`function main(rt) { return rt + SCALE; }`, {
          baseDirs: [tmpDir],
          target,
          defines: { SCALE: 1000 },
        });
        // The same source with the value inlined (fold on via a throwaway define) must
        // produce byte-identical output.
        const inlined = compile(`function main(rt) { return rt + 1000; }`, {
          baseDirs: [tmpDir],
          target,
          defines: { OTHER: 1 },
        });

        expect(Buffer.from(withDefine.bytecode[0])).toEqual(Buffer.from(inlined.bytecode[0]));
      });

      it('a define inside a partially-folding && condition does not throw', () => {
        const source = `function main(rt) { let x = 0n; if (FLAG && (rt === 1n)) { x = 1n; } return x; }`;

        expect(() => compile(source, { baseDirs: [tmpDir], target, defines: { FLAG: true } })).not.toThrow();
        expect(() => compile(source, { baseDirs: [tmpDir], target, defines: { FLAG: false } })).not.toThrow();
      });
    });
  }

  it('a const-true if is folded by default (no options needed)', () => {
    // fold defaults to true: `if (1 === 1)` needs no treeshake/defines to fold — it's
    // const-foldable on its own. Assert the default form differs from (is smaller than)
    // the explicit `fold: false` legacy form, which still emits a runtime branch.
    const source = `
      function main() {
        let x = 0n;
        if (1 === 1) { x = 7n; }
        return x;
      }
    `;

    const folded = compile(source);
    const legacy = compile(source, { fold: false });

    // Folding removes the runtime IF/JUMP scaffolding → strictly fewer bytes.
    expect(totalSize(folded.bytecode)).toBeLessThan(totalSize(legacy.bytecode));
    // `fold: false` output still contains the conditional-jump opcode (branch emitted).
    expect(Array.from(legacy.bytecode[0])).toContain(OPS.IF);
    // The default output does not — the dead branch scaffolding is gone entirely.
    expect(Array.from(folded.bytecode[0])).not.toContain(OPS.IF);
  });
});
