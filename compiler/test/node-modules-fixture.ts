import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Materializes a fake node_modules tree at runtime (never committed — `node_modules/` is
// gitignored at any depth in this repo, and committing one would also confuse pnpm/jest/
// eslint). `os.tmpdir()` is required, not merely idiomatic: the package walk-up climbs to
// the filesystem root, so a fixture placed inside the repo would find the repo's REAL
// `compiler/node_modules`/`sauce-sdk/node_modules` first.
//
// Layout (relative to the returned `projDir`, which callers pass as `baseDirs: [projDir]`):
//
//   node_modules/
//     @sauce/token/package.json   exports "." -> import/default "./token.js"
//                    token.js     tok() -> 1n
//                    token.svm.js tok() -> 2n              (per-target arm)
//                    util.js / util.svm.js                 (in-package relative sub-import)
//     modpkg/package.json         { module: "./lib/entry.js", main: "./cjs.js" }
//            lib/entry.js         imports "./helper.js"     (nested relative, module wins over main)
//            lib/helper.js
//            cjs.js               must NEVER be read (module field wins)
//     mainpkg/package.json        { main: "main.js" }
//             main.js
//     indexpkg/package.json       { name: "indexpkg" }      (no entry field -> index.js)
//             index.js
//     weirdexports/package.json   { exports: ["./a.js"], main: "./ok.js" }  (unmodeled -> main)
//                  ok.js
//     escapepkg/package.json      { main: "../../outside.js" }  (must throw, never read)
//     abipkg/package.json         { main: "./entry.js" }
//            entry.js             imports "./Tok.json"       (in-package ABI import)
//            Tok.json
//     nomanifest/index.js                                    (no package.json at all)
//     utils/index.js                                         (shadowed by proj/utils.js)
//   utils.js                                                 (path-before-package precedence control)
//   sub/deep.js                                              (bare-subpath-as-a-path control)
//   nested/consumer.js                                       (walk-up: resolves @sauce/token from proj)
//   shadowed/node_modules/@sauce/token/... + shadowed/consumer.js  (nested node_modules shadows outer)
//
//   <tmp root>/outside.js   escapepkg's escape target; a test asserts it is never loaded.
export interface NodeModulesFixture {
  projDir: string;
  outsidePath: string;
  cleanup: () => void;
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function makeNodeModulesFixture(): NodeModulesFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-node-modules-test-'));
  const projDir = path.join(root, 'proj');
  const nm = path.join(projDir, 'node_modules');

  // @sauce/token: exports "." with import/default -> ./token.js, plus a per-target arm and
  // an in-package relative sub-import (util.js / util.svm.js).
  write(
    path.join(nm, '@sauce/token/package.json'),
    JSON.stringify({ exports: { '.': { import: './token.js', default: './token.js' } } }),
  );
  write(path.join(nm, '@sauce/token/token.js'), `export function tok(){ return 1n; }`);
  write(path.join(nm, '@sauce/token/token.svm.js'), `export function tok(){ return 2n; }`);
  write(path.join(nm, '@sauce/token/util.js'), `export function utilFn(){ return 5n; }`);
  write(path.join(nm, '@sauce/token/util.svm.js'), `export function utilFn(){ return 6n; }`);

  // modpkg: `module` wins over `main`; entry.js has its OWN nested relative import.
  write(path.join(nm, 'modpkg/package.json'), JSON.stringify({ module: './lib/entry.js', main: './cjs.js' }));
  write(
    path.join(nm, 'modpkg/lib/entry.js'),
    `import { h } from "./helper.js";\nexport function useMod(){ return h(); }`,
  );
  write(path.join(nm, 'modpkg/lib/helper.js'), `export function h(){ return 7n; }`);
  write(path.join(nm, 'modpkg/cjs.js'), `export function useMod(){ throw "must never be read"; }`);

  // mainpkg: plain `main` field.
  write(path.join(nm, 'mainpkg/package.json'), JSON.stringify({ main: 'main.js' }));
  write(path.join(nm, 'mainpkg/main.js'), `export function useMain(){ return 8n; }`);

  // indexpkg: no entry field at all -> falls back to index.js.
  write(path.join(nm, 'indexpkg/package.json'), JSON.stringify({ name: 'indexpkg' }));
  write(path.join(nm, 'indexpkg/index.js'), `export function useIndex(){ return 9n; }`);

  // weirdexports: an unmodeled `exports` shape (array) degrades to `main`.
  write(path.join(nm, 'weirdexports/package.json'), JSON.stringify({ exports: ['./a.js'], main: './ok.js' }));
  write(path.join(nm, 'weirdexports/ok.js'), `export function useWeird(){ return 10n; }`);

  // escapepkg: entry escapes the package root; must throw before ever being read.
  write(path.join(nm, 'escapepkg/package.json'), JSON.stringify({ main: '../../outside.js' }));
  write(path.join(root, 'outside.js'), `throw "must never be loaded";`);

  // abipkg: entry.js imports its own sibling .json ABI (in-package ABI resolution).
  write(path.join(nm, 'abipkg/package.json'), JSON.stringify({ main: './entry.js' }));
  write(
    path.join(nm, 'abipkg/entry.js'),
    `import { AbiTok } from "./Tok.json";\nexport function useAbi(){ AbiTok.at(1).foo(); return 1n; }`,
  );
  write(
    path.join(nm, 'abipkg/Tok.json'),
    JSON.stringify({
      abi: [{ type: 'function', name: 'foo', inputs: [], outputs: [], stateMutability: 'nonpayable' }],
    }),
  );

  // nomanifest: no package.json at all -> falls back to index.js.
  write(path.join(nm, 'nomanifest/index.js'), `export function useNoManifest(){ return 11n; }`);

  // utils: a package that is SHADOWED by proj/utils.js (path-before-package precedence).
  write(path.join(nm, 'utils/index.js'), `export function u(){ throw "must never be read"; }`);

  // Path-before-package precedence control: a plain file at the baseDir wins over a same-
  // named installed package.
  write(path.join(projDir, 'utils.js'), `export function u(){ return 12n; }`);

  // Bare-subpath-as-a-path control: "sub/deep" resolves as an ordinary baseDir-relative path
  // (pre-existing behavior), never as a package subpath.
  write(path.join(projDir, 'sub/deep.js'), `export function d(){ return 13n; }`);

  // Walk-up: a module nested one directory below projDir, with NO node_modules of its own,
  // still finds node_modules/@sauce/token by climbing up to projDir.
  write(
    path.join(projDir, 'nested/consumer.js'),
    `import { tok } from "@sauce/token";\nexport function useNested(){ return tok(); }`,
  );

  // Walk-up precedence: a DIFFERENT nested dir with its OWN node_modules/@sauce/token shadows
  // the outer (projDir) one for a module importing from inside it.
  write(path.join(projDir, 'shadowed/node_modules/@sauce/token/package.json'), JSON.stringify({ main: './shadow.js' }));
  write(path.join(projDir, 'shadowed/node_modules/@sauce/token/shadow.js'), `export function tok(){ return 3n; }`);
  write(
    path.join(projDir, 'shadowed/consumer.js'),
    `import { tok } from "@sauce/token";\nexport function useShadowed(){ return tok(); }`,
  );

  return {
    projDir,
    outsidePath: path.join(root, 'outside.js'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
