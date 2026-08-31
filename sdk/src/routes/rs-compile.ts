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
import { dirname, join, resolve as resolvePath } from "node:path";

import type { CompileResult, CompileTarget, ContractsConfig } from "./compile-types.js";
// The RS compiler's own option/result types, from the package this file loads at runtime -- a
// hand-written mirror of them would drift with nothing to catch it.
import type {
  CompileOptions as RsCompileOptions,
  CompileResult as RsCompileResult,
  SauceTarget as RsTarget,
} from "sauce-compiler";

const ENTRY = "main.js";

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
 * A `resolve` that serves `source` as the entry and everything else from `baseDirs` — mirroring
 * multi-root probing, but simpler: confirmed empirically that the compiler hands `resolve` a
 * specifier ALREADY joined
 * against its importing module's own directory -- a relative import two hops deep arrives
 * pre-joined (e.g. `./sub/b.js`), never the raw `./b.js` as written at the call site -- so this
 * only ever needs to try each root directly, never re-derive an importer directory itself.
 */
function makeResolve(source: string, baseDirs: readonly string[]): (path: string) => Uint8Array | undefined {
  const entryBytes = Buffer.from(source, "utf8");
  return (path: string): Uint8Array | undefined => {
    if (path === ENTRY) return entryBytes;
    for (const dir of baseDirs) {
      const full = resolvePath(dir, path);
      try {
        if (statSync(full).isFile()) return readFileSync(full);
      } catch {
        continue;
      }
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

/** Index of the closing quote of the string/template literal opening at `open`. */
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
 * `main`'s OWN body — its opening brace to the matching close — with every string, template and
 * comment blanked out. Both halves are load-bearing for the `return` scan below: stopping at the
 * closing brace keeps a helper declared AFTER `main` out of it, and blanking literals keeps a
 * thrown `"…return…"` message from reading as code.
 */
function mainBody(source: string, from: number): string {
  const open = source.indexOf("{", from);
  if (open === -1) return "";

  const code: string[] = [];
  let depth = 0;

  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = endOfString(source, i);
      code.push(" ");
      continue;
    }
    if (ch === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
      i = endOfComment(source, i);
      code.push(" ");
      continue;
    }
    code.push(ch);
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) break;
  }

  return code.join("");
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
  const signature = /function(\s+)main(\s*)\(/.exec(source);
  if (signature === null) return source;

  // Walk to the signature's closing paren — a param list can nest (`Account<Writable>`), but never
  // parens, so counting them is enough.
  let depth = 0;
  let i = signature.index + signature[0].length - 1;
  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) break;
  }
  const afterParams = source.slice(i + 1);
  // Already annotated: leave it alone.
  if (/^\s*:/.test(afterParams)) return source;
  // It returns a value: leave it alone. Scanned over `mainBody` rather than the rest of the FILE,
  // which would also see a helper declared after `main` and the word inside a thrown message.
  if (/(^|[^.\w])return(\s|;)/.test(mainBody(source, i + 1))) return source;

  return `${source.slice(0, i + 1)}: void${afterParams}`;
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
