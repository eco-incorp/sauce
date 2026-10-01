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
import type { ResolveModule, ResolvePackage, SauceTarget as RsTarget } from "sauce-compiler";
import { resolveSdkModule, resolveSdkPackage, sdkStdPath } from "../embedded/resolve.js";
import { compile } from "../wasm-compiler.js";

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
function makeResolve(source: string, own: ResolveModule | undefined): ResolveModule {
  const entryBytes = new TextEncoder().encode(source);

  return (path) => {
    if (path === ENTRY) return entryBytes;
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
 * The compiler requires a function's return type to be declared rather than inferred. A route body
 * and the SDK's own generated sources are allowed to leave a `main` that returns nothing
 * unannotated, so the annotation is added here, at the single compile seam, after every rewrite
 * pass has run.
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
}

/**
 * Compiles `input.source` and adapts the result to the seam's own `CompileResult`, so
 * `compileSauceRoute` can slot it into `CompiledSauceRoute`.
 *
 * `bytecode` is a one-element list because a cook runs exactly one program; `warnings` is always
 * empty, since a real problem throws rather than being reported. The SVM account `manifest` is not
 * carried through -- nothing `compileSauceRoute` returns reads it, and an SVM caller that needs the
 * attach contract compiles through `svm/` directly.
 */
export function compileWithRs(input: RsCompileInput): CompileResult {
  const result = compile({
    target: mapTarget(input.target),
    entry: ENTRY,
    resolve: makeResolve(ensureVoidMain(input.source), input.resolve),
    resolvePackage: makeResolvePackage(input.resolvePackage),
    inlineContracts: toInlineContracts(input.contracts),
    ambient: input.ambient,
    defines: toRsDefines(input.defines),
    compactArgs: input.compactArgs,
  });

  return { bytecode: [result.bytecode], warnings: [], entrySchema: result.entrySchema };
}
