/**
 * The SDK's one compiler seam.
 *
 * Loads the SauceScript compiler (`sauce-compiler`, the published `@eco-incorp/sauce-compiler` wasm
 * package) and adapts its `compile({ resolve, resolvePackage, ... })` signature to the source-plus-
 * options shape `sauce-route.ts` calls with: a `source` string plus `baseDirs`/`defines`/`contracts`,
 * returning a `CompileResult` (`compile-types.ts`) so `CompiledSauceRoute` never names a compiler
 * type. Every other node-side recompile in the SDK (`svm/verify.ts`) goes through here too, so the
 * wasm module is loaded in exactly one place.
 */
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompileResult, CompileTarget, ContractsConfig } from "./compile-types.js";
// The RS compiler's own option/result types, from the package this file loads at runtime -- a
// hand-written mirror of them would drift with nothing to catch it.
import type {
  CompileOptions as RsCompileOptions,
  CompileResult as RsCompileResult,
  SauceTarget as RsTarget,
} from "sauce-compiler";

const ENTRY = "main.js";

/**
 * The SDK's own vendored SauceScript standard library root: `src/std` in dev, `dist/std` once built
 * (this file sits at `routes/`, one level below either). `copy-verify-assets.mjs` copies `std/` into
 * `dist/` and it is in the package `files` list, so a published consumer's route compile resolves it
 * the same way the in-repo suites do -- no `node_modules` install required, which is the whole reason
 * these ship as vendored source rather than as an npm dep the walk below would have to find.
 */
const STD_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "std");

/** The vendored-stdlib root, exported so a test can build the `"." + <abs>` shapes
 *  `vendoredStdlibPath` decides between without restating how the root is derived. */
export const VENDORED_STD_ROOT = STD_ROOT;

/**
 * The SDK stdlib packages resolvable by their bare specifier on the route path, mapped to their
 * directory under `STD_ROOT`. These resolve to the SDK's OWN vendored copy regardless of `baseDirs`
 * (they are never installed in a `node_modules` tree the walk below could find -- see
 * `plugin/index.ts`'s note), so this override runs BEFORE the `node_modules` walk in
 * `makeResolvePackage`. `@sauce/token`'s own `package.json` `main` is the neutral base the compiler
 * suffixes per target (`token.js` -> `token.evm.js`/`token.svm.js`), so `packageEntry` reads it and
 * the arm probe + the arm's own relative `./erc20.abi.json` are served by `makeResolve`'s
 * absolute-path branch.
 */
const SDK_STD_PACKAGES: Readonly<Record<string, string>> = {
  "@sauce/token": "token",
};

let rsCompileFn: ((options: RsCompileOptions) => RsCompileResult) | undefined;

/** Lazily loads the wasm module — only paid once something actually compiles. */
function loadRsCompile(): (options: RsCompileOptions) => RsCompileResult {
  if (rsCompileFn) return rsCompileFn;
  // Required via `createRequire`, not `import`: the package's `node` condition is a CommonJS build
  // that reads its sibling `.wasm` off disk at load, and Node's own CJS loader is the one that
  // resolves that sibling -- an ESM/bundler loader does not. Mirrors `test/std/token/harness.ts`.
  let mod: { compile: (options: RsCompileOptions) => RsCompileResult };
  try {
    mod = createRequire(import.meta.url)("sauce-compiler") as typeof mod;
  } catch (cause) {
    throw new Error(
      "the SauceScript compiler (`sauce-compiler` -> the published @eco-incorp/sauce-compiler) failed to load.",
      { cause },
    );
  }
  rsCompileFn = mod.compile;
  return rsCompileFn;
}

/** v1/v12 both compile through the RS compiler's single EVM backend; svm maps 1:1. */
function mapTarget(target: CompileTarget): RsTarget {
  return target === "svm" ? "svm" : "evm";
}

/** A define is one 256-bit word, spelled as a literal integer string; booleans map to 1/0. */
function defineValue(v: bigint | boolean | number): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  return Math.trunc(v).toString();
}

function toRsDefines(
  defines: Record<string, bigint | boolean | number> | undefined,
): Array<[string, string]> | undefined {
  if (!defines) return undefined;
  const entries = Object.entries(defines).map(([name, v]) => [name, defineValue(v)] as [string, string]);
  return entries.length > 0 ? entries : undefined;
}

/**
 * `sauce-route.ts`'s `contracts: ContractsConfig` (`Record<name, {abi}>`) already holds PARSED ABI
 * JSON in memory (synthesized by `protocol-rewrite.ts`, or handed in directly by a caller) --
 * never a filesystem path -- so it maps onto the RS compiler's `inlineContracts: [name, abiJson][]`
 * (a caller-holds-the-ABI-already option), not its path-based `contracts` option (the WASM mirror
 * of a `sauce.toml` `[contracts]` table, which expects a `resolve()`-able PATH per entry --
 * something this seam never has).
 */
function toInlineContracts(contracts: ContractsConfig | undefined): Array<[string, string]> | undefined {
  if (!contracts) return undefined;
  const entries = Object.entries(contracts).map(([name, cfg]) => [name, JSON.stringify(cfg.abi)] as [string, string]);
  return entries.length > 0 ? entries : undefined;
}

/**
 * The absolute path a `"." + <abs>` specifier names, when it names a file inside the vendored
 * stdlib — otherwise `undefined`.
 *
 * The compiler prefixes an importer-joined specifier with ".", so a vendored package's own relative
 * import (`./erc20.abi.json`) arrives as `"."` + its absolute location under `STD_ROOT`. This is
 * **disambiguation, not containment**: `makeResolve` already serves any absolute path directly, so
 * the `STD_ROOT` test is not a sandbox and is not load-bearing for safety. What it decides is which
 * of two same-looking shapes this is — a stripped absolute stdlib path, or a genuine `./rel` from
 * an entry program, which must fall through to `baseDirs` instead of being read as a path from the
 * filesystem root.
 */
export function vendoredStdlibPath(path: string): string | undefined {
  if (!path.startsWith("./")) return undefined;
  const abs = path.slice(1);

  return isAbsolute(abs) && abs.startsWith(STD_ROOT) ? abs : undefined;
}

/**
 * A `resolve` that serves `source` as the entry and everything else from `baseDirs` — mirroring
 * multi-root probing, but simpler: confirmed empirically that the compiler hands `resolve` a
 * specifier ALREADY joined
 * against its importing module's own directory -- a relative import two hops deep arrives
 * pre-joined (e.g. `./sub/b.js`), never the raw `./b.js` as written at the call site -- so this
 * only ever needs to try each root directly, never re-derive an importer directory itself.
 */
function makeResolve(source: string, baseDirs: readonly string[]): (path: string) => Uint8Array | undefined {
  const entryBytes = Buffer.from(source, "utf8");
  const readFile = (full: string): Uint8Array | undefined => {
    try {
      return statSync(full).isFile() ? readFileSync(full) : undefined;
    } catch {
      return undefined;
    }
  };
  return (path: string): Uint8Array | undefined => {
    if (path === ENTRY) return entryBytes;
    // An ABSOLUTE path is served directly, independent of `baseDirs`: `makeResolvePackage` returns
    // absolute stdlib entry paths (`SDK_STD_PACKAGES`), and the arm probe (`token.evm.js`) reaches
    // here absolute too. `openRoute` supplies no `baseDirs`, so without this branch the loop below
    // never runs and every ambient-stdlib resolution would miss.
    if (isAbsolute(path)) return readFile(path);
    // The compiler prefixes an importer-joined specifier with ".": for a module at an ABSOLUTE
    // location (the vendored stdlib under STD_ROOT), a package's own relative import
    // (`./erc20.abi.json`) therefore arrives as "." + "/abs/path". Strip the single leading "." and
    // serve it ONLY when the remainder is an absolute path inside STD_ROOT -- so a genuine "./rel"
    // (an entry program's own import, served from `baseDirs` below) is never mistaken for one.
    const vendored = vendoredStdlibPath(path);
    if (vendored !== undefined) return readFile(vendored);
    for (const dir of baseDirs) {
      const bytes = readFile(resolvePath(dir, path));
      if (bytes !== undefined) return bytes;
    }
    return undefined;
  };
}

/**
 * Walks up from each baseDir looking for `node_modules/<pkg>` -- so a bare specifier (e.g.
 * `@sauce/token`) resolves whenever a caller's baseDirs sit under a real node_modules tree. Returns an ABSOLUTE path; `makeResolve`'s
 * `resolvePath(dir, path)` returns an absolute input unchanged regardless of which `dir` is tried,
 * so this slots straight back through the same resolver.
 */
function makeResolvePackage(baseDirs: readonly string[]): (specifier: string) => string | undefined {
  return (specifier: string): string | undefined => {
    // The SDK's own vendored stdlib resolves from `STD_ROOT` regardless of `baseDirs` -- it is never
    // in a `node_modules` tree the walk below could find, so it must be matched first.
    const stdSubdir = SDK_STD_PACKAGES[specifier];
    if (stdSubdir !== undefined) {
      const pkgDir = resolvePath(STD_ROOT, stdSubdir);
      return resolvePath(pkgDir, packageEntry(pkgDir));
    }
    const pkgDir = findPackageDir(specifier, baseDirs);
    return pkgDir ? resolvePath(pkgDir, packageEntry(pkgDir)) : undefined;
  };
}

function findPackageDir(pkg: string, baseDirs: readonly string[]): string | undefined {
  const visited = new Set<string>();
  for (const base of baseDirs) {
    let dir = resolvePath(base);
    for (;;) {
      if (visited.has(dir)) break;
      visited.add(dir);
      const candidate = join(dir, "node_modules", pkg);
      try {
        if (statSync(candidate).isDirectory()) return candidate;
      } catch {
        // not here, keep climbing
      }
      const parent = dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }
  }
  return undefined;
}

/** `.`/"module"/"main" only -- a small, deliberately non-exhaustive subset of real Node
 *  resolution. Falls back to `index.js`. */
function packageEntry(pkgDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as Record<string, unknown>;
    if (typeof pkg.module === "string") return pkg.module;
    if (typeof pkg.main === "string") return pkg.main;
  } catch {
    // fall through to the default below
  }
  return "index.js";
}

/**
 * Index of the closing quote of the string/template literal opening at `open`.
 *
 * Template interpolation does not nest here: `${…}` is scanned as ordinary string body, so a
 * backtick inside one would end the literal early. That is sound only because the language subset
 * rejects template literals outright (`\`{ return }\`` fails as "not supported in the M1 subset"),
 * leaving `hex\`…\`` -- the one tagged form it accepts -- which cannot contain an interpolation.
 */
function endOfString(source: string, open: number): number {
  const quote = source[open];
  for (let i = open + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === quote) return i;
  }

  return source.length;
}

/** Index of the last character of the `//` or block comment opening at `open`. */
function endOfComment(source: string, open: number): number {
  if (source[open + 1] === "/") {
    const newline = source.indexOf("\n", open);

    return newline === -1 ? source.length - 1 : newline;
  }
  const close = source.indexOf("*/", open);

  return close === -1 ? source.length - 1 : close + 1;
}

/**
 * `source` with every string, template literal and comment replaced by spaces (newlines kept).
 * LENGTH-PRESERVING, so an index into the original still names the same character — which is what
 * lets the brace search in `mainBody` run on the blanked copy.
 */
function blankLiterals(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, " ");
  const blanked: string[] = [];

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const isLiteral = ch === '"' || ch === "'" || ch === "`";
    const isComment = ch === "/" && (source[i + 1] === "/" || source[i + 1] === "*");
    if (!isLiteral && !isComment) {
      blanked.push(ch);
      continue;
    }
    const end = isLiteral ? endOfString(source, i) : endOfComment(source, i);
    blanked.push(blank(source.slice(i, end + 1)));
    i = end;
  }

  return blanked.join("");
}

/**
 * `main`'s OWN body — its opening brace to the matching close — taken from an ALREADY-blanked
 * `code`. Stopping at the closing brace keeps a helper declared AFTER `main` out of the `return`
 * scan below, and the blanking keeps a thrown `"…return…"` message from reading as code.
 */
function mainBody(code: string, from: number): string {
  const open = code.indexOf("{", from);
  if (open === -1) return "";

  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return code.slice(open, i + 1);
  }

  return code.slice(open);
}

/**
 * Declare `main` void when it falls off the end.
 *
 * The compiler requires a function's return type to be declared rather than inferred, but the SDK's
 * source generators must emit PLAIN JS: the token-member and protocol-accessor rewrites are
 * acorn-based and cannot parse a type annotation. So the annotation is added here, at the single
 * compile seam, after every rewrite pass has run.
 */
export function ensureVoidMain(source: string): string {
  // EVERY search below runs on the blanked copy, never the raw source: an earlier string or comment
  // containing `function main()` would otherwise be the match, and a paren inside a parameter's
  // default-value string would close the param list early — either one lands `: void` mid-source.
  // Blanking is length-preserving, so every index still names the same character in `source`.
  const code = blankLiterals(source);
  const signature = /function(\s+)main(\s*)\(/.exec(code);
  if (signature === null) return source;

  // Walk to the signature's closing paren — a param list can nest (`Account<Writable>`), but never
  // parens, so counting them is enough.
  let depth = 0;
  let i = signature.index + signature[0].length - 1;
  for (; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) break;
  }
  // Already annotated: leave it alone.
  if (/^\s*:/.test(code.slice(i + 1))) return source;
  // It returns a value: leave it alone. Scanned over `mainBody` rather than the rest of the FILE,
  // which would also see a helper declared after `main`.
  if (/(^|[^.\w])return(\s|;)/.test(mainBody(code, i + 1))) return source;

  return `${source.slice(0, i + 1)}: void${source.slice(i + 1)}`;
}

export interface RsCompileInput {
  source: string;
  target: CompileTarget;
  baseDirs?: string[];
  defines?: Record<string, bigint | boolean | number>;
  contracts?: ContractsConfig;
  /** Module specifiers broadcast into every module with no `import` line -- see this file's own
   *  header for why this option only exists here, not on the TS path. */
  ambient?: string[];
}

/**
 * Compiles `input.source` and adapts the result to the seam's own `CompileResult`, so
 * `compileSauceRoute` can slot it into `CompiledSauceRoute`.
 *
 * `bytecode` is a one-element list because a cook executes `ingredients[0]`; `warnings` is always
 * empty, since a real problem throws rather than being reported. The SVM account `manifest` is not
 * carried through -- nothing `compileSauceRoute` returns reads it, and an SVM caller that needs the
 * attach contract compiles through `svm/` directly.
 */
export function compileWithRs(input: RsCompileInput): CompileResult {
  const compile = loadRsCompile();
  const baseDirs = input.baseDirs ?? [];

  const result = compile({
    target: mapTarget(input.target),
    entry: ENTRY,
    resolve: makeResolve(ensureVoidMain(input.source), baseDirs),
    resolvePackage: makeResolvePackage(baseDirs),
    inlineContracts: toInlineContracts(input.contracts),
    ambient: input.ambient,
    defines: toRsDefines(input.defines),
  });

  return { bytecode: [result.bytecode], warnings: [] };
}
