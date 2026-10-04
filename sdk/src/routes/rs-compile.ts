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
  BoundArgument,
  CallSite,
  EntrySignature,
  ProgramReport,
  ResolveModule,
  ResolvePackage,
  SauceTarget as RsTarget,
} from "sauce-compiler";
import { resolveSdkModule, resolveSdkPackage, sdkStdPath } from "../embedded/resolve.js";
import { compile } from "../wasm-compiler.js";
// Type-only: `host.ts` reaches the route compile through the registry's accessors, and a value
// import here would load it ahead of a test's module mocks.
import type { ChainHost } from "./host.js";

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

/** A frozen defines object's pairs, converted once: a chain's own defines are one frozen object on
 *  every compile. An object that can change is converted each time. */
const frozenPairs = new WeakMap<object, ReadonlyArray<readonly [string, string]>>();
/** Each frozen object's values by name, with their converted spelling, for an object spread from it. */
const frozenValues = new WeakMap<object, ReadonlyMap<string, readonly [unknown, string]>>();

function pairsOf(
  defines: Readonly<Record<string, bigint | boolean | number>>,
): ReadonlyArray<readonly [string, string]> {
  const cached = frozenPairs.get(defines);
  if (cached !== undefined) return cached;
  const pairs = Object.entries(defines).map(([name, v]) => [name, defineValue(v)] as const);
  if (Object.isFrozen(defines)) frozenPairs.set(defines, pairs);
  return pairs;
}

/**
 * `defines` as the compiler's pairs. `base` is the frozen object `defines` is, or was spread from:
 * a value `defines` still has from it keeps the spelling worked out once for `base`.
 */
export function toRsDefines(
  defines: Readonly<Record<string, bigint | boolean | number>> | undefined,
  base?: Readonly<Record<string, bigint | boolean | number>>,
): Array<[string, string]> | undefined {
  if (!defines) return undefined;
  let entries: Array<[string, string]>;
  if (base === undefined || defines === base || !Object.isFrozen(base)) {
    entries = pairsOf(defines).map(([name, value]) => [name, value]);
  } else {
    let known = frozenValues.get(base);
    if (known === undefined) {
      const spelled = new Map(pairsOf(base));
      known = new Map(Object.entries(base).map(([name, v]) => [name, [v, spelled.get(name)!]]));
      frozenValues.set(base, known);
    }
    const from = known;
    entries = Object.entries(defines).map(([name, v]) => {
      const was = from.get(name);
      return [name, was !== undefined && was[0] === v ? was[1] : defineValue(v)];
    });
  }
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
 * lets a search for `main` run on the blanked copy.
 */
export function blankLiterals(source: string): string {
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

export interface RsCompileInput {
  source: string;
  target: CompileTarget;
  /** The caller's modules, consulted before the SDK's own for every path but the standard library. */
  resolve?: ResolveModule;
  /** The caller's bare-specifier mapping, consulted after the SDK's standard library. */
  resolvePackage?: ResolvePackage;
  defines?: Readonly<Record<string, bigint | boolean | number>>;
  /** The frozen object `defines` is, or was spread from: the chain's own values, one object compile
   *  after compile, whose spelling for the compiler is worked out once. */
  baseDefines?: Readonly<Record<string, bigint | boolean | number>>;
  contracts?: ContractsConfig;
  /** Module specifiers broadcast into every module with no `import` line -- see this file's own
   *  header for why this option only exists here, not on the TS path. */
  ambient?: string[];
  /** Compile for compact-v1 entry arguments, returning the schema they must be encoded against. */
  compactArgs?: boolean;
  /** The value of each of `main`'s parameters, as a word, when the program is compiled for them:
   *  the compiler's `args` (`entry.ts#entryArguments`). */
  args?: readonly string[];
  /** The names the chain gives the program (`host.ts#chainHost`): asked of, never written in. */
  host?: ChainHost;
  /** `"closure"`: `source` is one function expression as `Function.prototype.toString` prints it,
   *  compiled as the entry as it stands. Default `"module"`. */
  entryKind?: "module" | "closure";
}

/** The seam's `CompileResult`, plus what `compileSauceProgram` reports beyond it: how entry
 *  arguments are encoded, and the SVM account manifest when the compiler returned one. */
export interface RsCompileResult extends CompileResult {
  entryEncoding: "abi-v1" | "compact-v1";
  manifest?: AccountManifest;
  /** `main`'s parameters as the compiler reports them: an ABI signature, `Account`s left out. */
  entryParams: readonly AbiParameter[];
  /** `main`'s signature as the program declares it, from every compile, one for `args` included. */
  entrySignature: EntrySignature;
  /** Every program argument the compile compiled, each with where it is written. */
  programs: readonly ProgramReport[];
}

/** A host's `bind` as the compiler takes it: every site-bound call answered, or refused by name. */
export function compilerBind(
  bind: ChainHost["bind"],
): ((site: CallSite) => BoundArgument[]) | undefined {
  return bind === undefined
    ? undefined
    : (site) => {
        const bound = bind(site);
        if (bound === undefined) throw new Error(`'${site.callee}' is bound by no host`);
        return bound;
      };
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
  const result = compile({
    target: mapTarget(input.target),
    entry: ENTRY,
    entryKind: input.entryKind ?? "module",
    resolve: makeResolve(input.source, input.resolve),
    resolvePackage: makeResolvePackage(input.resolvePackage),
    inlineContracts: toInlineContracts(input.contracts),
    ambient: input.ambient,
    defines: toRsDefines(input.defines, input.baseDefines),
    compactArgs: input.compactArgs,
    ...(input.args === undefined ? {} : { args: [...input.args] }),
    ...(input.host === undefined
      ? {}
      : {
          declare: input.host.declare,
          types: input.host.types,
          hostModules: input.host.hostModules,
          nested: input.host.nested,
          bind: compilerBind(input.host.bind),
        }),
  });

  const compiled: RsCompileResult = {
    bytecode: [result.bytecode],
    warnings: [],
    entrySchema: result.entrySchema,
    entryEncoding: result.entryEncoding,
    entryParams: result.entryParams,
    entrySignature: result.entrySignature,
    programs: result.programs,
  };
  if (result.manifest !== undefined) compiled.manifest = result.manifest;

  return compiled;
}
