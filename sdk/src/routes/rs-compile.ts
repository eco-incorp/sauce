/**
 * P6 — the RS/WASM compiler adapter for `compileSauceRoute`'s compiler-selector seam
 * (`sauce-route.ts`).
 *
 * Loads the ambient-capable Rust SauceScript compiler (`sauce-next`, the published
 * `@eco-incorp/sauce-compiler` — the same load pattern `test/std/token/harness.ts` already uses) and
 * adapts its `compile({ resolve, resolvePackage, ... })` signature to the shape `sauce-route.ts`
 * already calls the TS compiler with: a `source` string plus `baseDirs`/`defines`/`contracts`,
 * returning a `CompileResult` (`@eco-incorp/sauce-compiler`'s own type) so the RS path slots into
 * `CompiledSauceRoute` with no caller-visible difference.
 *
 * WHY THIS EXISTS: `ambient` (broadcasting a module's exports into every module with no `import`
 * line) exists ONLY on the RS compiler today — this is the seam that lets an SDK caller opt into
 * it. Every other option below is a best-effort translation of what the TS call site already
 * passes; see the per-field notes.
 */
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";

import type { CompileResult, CompileTarget, ContractsConfig } from "@eco-incorp/sauce-compiler";
// The RS compiler's own option/result types, from the package this file loads at runtime -- a
// hand-written mirror of them would drift with nothing to catch it.
import type {
  CompileOptions as RsCompileOptions,
  CompileResult as RsCompileResult,
  SauceTarget as RsTarget,
} from "sauce-next";

const ENTRY = "main.js";

let rsCompileFn: ((options: RsCompileOptions) => RsCompileResult) | undefined;

/** Lazily loads the wasm module — only paid by a caller that actually picks `compiler: 'rs'`. */
function loadRsCompile(): (options: RsCompileOptions) => RsCompileResult {
  if (rsCompileFn) return rsCompileFn;
  // Required via `createRequire`, not `import`: the package's `node` condition is a CommonJS build
  // that reads its sibling `.wasm` off disk at load, and Node's own CJS loader is the one that
  // resolves that sibling -- an ESM/bundler loader does not. Mirrors `test/std/token/harness.ts`.
  let mod: { compile: (options: RsCompileOptions) => RsCompileResult };
  try {
    mod = createRequire(import.meta.url)("sauce-next") as typeof mod;
  } catch (cause) {
    throw new Error(
      "compiler: 'rs' requires the Rust SauceScript compiler (`sauce-next` -> @eco-incorp/sauce-compiler).",
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

/** Matches the TS compiler's own `defines` convention ("Booleans map to 1n/0n") -- the RS
 *  compiler's `defines` takes each value as a literal integer string instead of a typed union. */
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
 * the TS compiler's own multi-root probing (`CompilerContext#resolveInRoots`), but simpler:
 * confirmed empirically (see the P6 report) that RS hands `resolve` a specifier ALREADY joined
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
 * Walks up from each baseDir looking for `node_modules/<pkg>`, mirroring the TS compiler's own
 * `findPackageDir`/`packageEntry` (`compiler/src/context.ts`) -- so a bare specifier (e.g.
 * `@sauce/token`) resolves the same way on both compiler paths whenever a caller's baseDirs sit
 * under a real node_modules tree. Returns an ABSOLUTE path; `makeResolve`'s
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
 *  resolution, matching the TS compiler's own `packageEntry`. Falls back to `index.js`. */
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
 * Compiles `input.source` through the RS/WASM compiler and adapts its result back to the TS
 * compiler's own `CompileResult` shape, so `compileSauceRoute` can slot it into
 * `CompiledSauceRoute` unchanged.
 *
 * NOTE: the RS `manifest` (SVM account list) is NOT translated into the TS compiler's
 * `accountPlan` -- the two shapes are lossy in different directions (RS's `AccountEntry` carries
 * no writable/signer flags; the TS `AccountPlan`'s `AccountMeta` carries no `remaining`-tail
 * marker) and nothing `compileSauceRoute` returns today reads `compiled.accountPlan` -- so this is
 * a deliberate, documented scope cut, not an oversight. `warnings` is always `[]` -- the RS
 * compiler throws on a real problem rather than returning warnings.
 */
export function compileWithRs(input: RsCompileInput): CompileResult {
  const compile = loadRsCompile();
  const baseDirs = input.baseDirs ?? [];

  const result = compile({
    target: mapTarget(input.target),
    entry: ENTRY,
    resolve: makeResolve(input.source, baseDirs),
    resolvePackage: makeResolvePackage(baseDirs),
    inlineContracts: toInlineContracts(input.contracts),
    ambient: input.ambient,
    defines: toRsDefines(input.defines),
  });

  return { bytecode: [result.bytecode], warnings: [] };
}
