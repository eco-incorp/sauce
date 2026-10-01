/**
 * The route compiler's adapter onto the SauceScript compiler.
 *
 * Adapts the compiler's `compile({ resolve, resolvePackage, ... })` signature (through
 * `wasm-compiler.ts`, the SDK's one import of the wasm package) to the source-plus-options shape
 * `sauce-route.ts` calls with: a `source` string plus `resolve`/`defines`/`contracts`, returning a
 * `CompileResult` (`compile-types.ts`) so `CompiledSauceRoute` never names a compiler type. The
 * SDK's other recompile (`svm/verify.ts`) goes through here too.
 */
import type { CompileResult, CompileTarget, ContractsConfig } from "./compile-types.js";
// The RS compiler's own option/result types, from the package `wasm-compiler.ts` loads -- a
// hand-written mirror of them would drift with nothing to catch it.
import type {
  AbiParameter,
  AccountManifest,
  ResolveModule,
  ResolvePackage,
  SauceTarget as RsTarget,
} from "sauce-compiler";
import type { CanonicalChain } from "../chains/canonical.js";
import { resolveSdkModule, resolveSdkPackage, sdkStdPath } from "../embedded/resolve.js";
import { compile } from "../wasm-compiler.js";
import { EXTENSIONS_PATH, serveExtensions, type ExtensionsOptions } from "./extensions.js";

const ENTRY = "main.js";

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
  const entries = Object.entries(defines).map(
    ([name, v]) => [name, defineValue(v)] as [string, string],
  );
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
function toInlineContracts(
  contracts: ContractsConfig | undefined,
): Array<[string, string]> | undefined {
  if (!contracts) return undefined;
  const entries = Object.entries(contracts).map(
    ([name, cfg]) => [name, JSON.stringify(cfg.abi)] as [string, string],
  );
  return entries.length > 0 ? entries : undefined;
}

/**
 * A `resolve` that serves `source` as the entry, then the caller's modules, then the SDK's own.
 *
 * The compiler hands `resolve` a specifier already joined against its importer's directory (a
 * relative import two hops deep arrives as `./sub/b.js`), so no importer directory is re-derived
 * here. The SDK's standard library is never offered to the caller's `resolve`: `@sauce/token`
 * resolves to the SDK's copy whatever the caller supplies. Every other path reaches the caller's
 * `resolve` before the SDK's embedded ABIs, so a caller can serve its own `./artifacts/IERC20.json`.
 */
function makeResolve(
  source: string,
  own: ResolveModule | undefined,
  extensions?: (path: string) => Uint8Array | undefined,
): ResolveModule {
  const entryBytes = new TextEncoder().encode(source);

  return (path) => {
    if (path === ENTRY) return entryBytes;
    // The manifest is the SDK's, like the standard library: a caller's `resolve` never serves it.
    const manifest = extensions?.(path);
    if (manifest !== undefined) return manifest;
    if (own !== undefined && sdkStdPath(path) === undefined) {
      const bytes = own(path);
      if (bytes !== undefined && bytes !== null) return bytes;
    }

    return resolveSdkModule(path);
  };
}

/** Bare specifiers: the SDK's standard library first, then the caller's `resolvePackage`. */
function makeResolvePackage(own: ResolvePackage | undefined): ResolvePackage {
  return (specifier, importer) =>
    resolveSdkPackage(specifier) ?? own?.(specifier, importer) ?? undefined;
}

export interface RsCompileInput {
  source: string;
  target: CompileTarget;
  /** The caller's modules, consulted before the SDK's own for every path but the standard library. */
  resolve?: ResolveModule;
  /** The caller's bare-specifier mapping, consulted after the SDK's standard library. */
  resolvePackage?: ResolvePackage;
  defines?: Record<string, bigint | boolean | number>;
  contracts?: ContractsConfig;
  /** Module specifiers broadcast into every module with no `import` line -- see this file's own
   *  header for why this option only exists here, not on the TS path. */
  ambient?: string[];
  /** Compile for compact-v1 entry arguments, returning the schema they must be encoded against. */
  compactArgs?: boolean;
  /**
   * Give the program the extensions manifest for `chain` (`extensions.ts`): every chain's tokens,
   * protocols and the SDK's global spellings, resolved by the compiler with no source rewrite.
   */
  extensions?: ExtensionsOptions & { readonly chain: CanonicalChain };
  /** `"closure"`: `source` is one function expression, as `Function.prototype.toString` prints it. */
  entryKind?: "module" | "closure";
}

/** The seam's `CompileResult`, plus what `compileSauceProgram` reports beyond it: how entry
 *  arguments are encoded, `main`'s parameters as the compiler read them, and the SVM account
 *  manifest when the compiler returned one. */
export interface RsCompileResult extends CompileResult {
  entryEncoding: "abi-v1" | "compact-v1";
  /** `main`'s runtime parameters as an ABI signature — on Solana without its `Account` slots. */
  entryParams: AbiParameter[];
  manifest?: AccountManifest;
}

/**
 * Compiles `input.source` and adapts the result to the seam's own `CompileResult`, so
 * `compileSauceRoute` can slot it into `CompiledSauceRoute`.
 *
 * `bytecode` is a one-element list because a cook runs exactly one program; `warnings` is always
 * empty, since a real problem throws rather than being reported. The SVM account `manifest` rides
 * alongside for `compileSauceProgram`, which hands it to the `sauce` command; `compileSauceRoute`
 * returns none, and an SVM caller that needs the attach contract compiles through `svm/` directly.
 */
export function compileWithRs(input: RsCompileInput): RsCompileResult {
  const extensions =
    input.extensions === undefined
      ? undefined
      : serveExtensions(input.extensions.chain, input.extensions);
  const source = input.source;
  const result = compile({
    target: mapTarget(input.target),
    entry: ENTRY,
    ...(extensions === undefined ? {} : { extensions: EXTENSIONS_PATH }),
    ...(input.entryKind === undefined ? {} : { entryKind: input.entryKind }),
    resolve: makeResolve(source, input.resolve, extensions),
    resolvePackage: makeResolvePackage(input.resolvePackage),
    inlineContracts: toInlineContracts(input.contracts),
    ambient: input.ambient,
    defines: toRsDefines(input.defines),
    compactArgs: input.compactArgs,
  });

  const compiled: RsCompileResult = {
    bytecode: [result.bytecode],
    warnings: [],
    entrySchema: result.entrySchema,
    entryEncoding: result.entryEncoding,
    entryParams: result.entryParams,
  };
  if (result.manifest !== undefined) compiled.manifest = result.manifest;

  return compiled;
}
