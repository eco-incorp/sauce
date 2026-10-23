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
  CompileOptions,
  ResolveModule,
  ResolvePackage,
  SauceTarget as RsTarget,
} from "sauce-compiler";
import {
  resolveSdkModule,
  resolveSdkPackage,
  SDK_STD_ROOT,
  sdkStdPath,
} from "../embedded/resolve.js";
import { compile } from "../wasm-compiler.js";
import { entrySignatureOf, type EntrySignature } from "./entry.js";

/** The path the compiler gives the program's own source. */
export const ENTRY = "main.js";

/** v1/v12 both compile through the RS compiler's single EVM backend; svm maps 1:1. */
export function mapTarget(target: CompileTarget): RsTarget {
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
function toRsDefines(
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
export function makeResolve(source: string, own: ResolveModule | undefined): ResolveModule {
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
export function makeResolvePackage(own: ResolvePackage | undefined): ResolvePackage {
  return (specifier, importer) =>
    resolveSdkPackage(specifier) ?? own?.(specifier, importer) ?? undefined;
}

/**
 * `fn`, answering each argument list as it first did: the same bytes or path, or the same error
 * thrown again. One compile reads the caller's `resolve` and `resolvePackage` through one of these
 * each, so its probe of the names they bind (`ambientNamesOf`) and the compile itself read the same
 * modules, however the caller answers when asked again. Bytes are kept as a copy of what was first
 * served, since a resolver may hand out one buffer and write the next module into it. It is the
 * compile's own: the next compile makes its own, and asks the caller afresh.
 */
export function firstAnswers<A extends readonly string[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const answers = new Map<string, { readonly value: R } | { readonly error: unknown }>();

  return (...args) => {
    const key = JSON.stringify(args);
    let answer = answers.get(key);
    if (answer === undefined) {
      try {
        const value = fn(...args);
        // A copy of a `Uint8Array` is one, whatever its subclass (a Node `Buffer`'s `slice` is a view).
        answer = { value: value instanceof Uint8Array ? (Uint8Array.from(value) as R) : value };
      } catch (error) {
        answer = { error };
      }
      answers.set(key, answer);
    }
    if ("error" in answer) throw answer.error;

    return answer.value;
  };
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
  /** `main`'s arguments the program is compiled for, one word each, in `entryParams`' order. */
  args?: readonly (bigint | boolean | string)[];
}

/** The seam's `CompileResult`, plus what `compileSauceProgram` reports beyond it: how entry
 *  arguments are encoded, and the SVM account manifest when the compiler returned one. */
export interface RsCompileResult extends CompileResult {
  entryEncoding: "abi-v1";
  manifest?: AccountManifest;
  /** `main`'s parameters as the compiler reports them: an ABI signature, `Account`s left out. */
  entryParams: readonly AbiParameter[];
  /** `main`'s signature, as far as the compile reports it. */
  entrySignature: EntrySignature;
}

/** What a probe compiles with: a compile's options, without its program and `main`'s arguments. */
export type RsProbeInput = Omit<RsCompileInput, "source" | "args">;

/** The options a compile and a probe of it share, so the two cannot be given different ones. */
function sharedOptions(input: RsProbeInput): Omit<CompileOptions, "resolve"> {
  return {
    target: mapTarget(input.target),
    entry: ENTRY,
    resolvePackage: makeResolvePackage(input.resolvePackage),
    inlineContracts: toInlineContracts(input.contracts),
    ambient: input.ambient,
    defines: toRsDefines(input.defines, input.baseDefines),
  };
}

/**
 * The module a probe adds to the ambient ones, exporting each name the probe asks about. It stands
 * under the SDK's standard library, whose paths never reach the caller's `resolve`
 * (`makeResolve`), so no module a caller serves, ambient or imported, is at it.
 */
const PROBE_MODULE = `.${SDK_STD_ROOT}/__sauce_probe.js`;
/**
 * The probe's program after the program's own imports: a `main` that reads nothing, so no name it
 * binds is its own, and a function nothing calls that writes a closure. A compile with a closure
 * lowers only what its `main` reaches, so the probe lowers nothing. One without would lower every
 * function of every module, which the compile of a program that has one does not, and could fail
 * on a function only a closure's program can compile.
 */
const PROBE_PROGRAM =
  "function main(): void {}\nfunction __sauce_probe(): bytes {\n  return program(() => 0).code;\n}\n";
/** The compiler's refusal of a name two ambient modules export, which names it. */
const EXPORTED_TWICE = /`([A-Za-z_$][\w$]*)` is exported by more than one ambient module/;

/**
 * The names among `names` that one of `input.ambient`'s modules exports, as the compiler finds them:
 * the compiler is asked, never the SDK. A probe compiles `imports`, the program's own import
 * declarations as written, then a `main` that reads nothing (`PROBE_PROGRAM`), at the program's
 * path with `input`'s options and one more ambient module, which exports every name asked about.
 * The compiler loads an entry's imports before the ambient modules and loads a module once, so with
 * the same imports it loads the same modules, each where the compile does (a `resolvePackage` that
 * answers by importer included). It refuses a name two ambient modules export, naming it, so each
 * name it refuses is one a caller's module exports; it is set aside and the rest asked again. A
 * compile the probe's names do not trouble ends the probe.
 *
 * Any other refusal leaves every name still asked about as the caller's, never the Pot's. What the
 * compiler checks before it compares the ambient modules' exports, the probe and the compile share
 * (the modules, the options, the imports), so the compile is refused too and reports it as it
 * reports any refusal; after it, the probe compiles nothing but its own `main`.
 *
 * Nothing is remembered between calls: one `resolve` may serve other text on the next compile. The
 * compiler's own caches, keyed by each module's text, keep a probe that reads nothing new cheap.
 */
export function ambientNamesOf(
  input: RsProbeInput,
  names: Iterable<string>,
  imports: readonly string[],
): Set<string> {
  const found = new Set<string>();
  const asked = new Set(names);
  if (asked.size === 0 || input.ambient === undefined || input.ambient.length === 0) return found;
  const program = makeResolve([...imports, PROBE_PROGRAM].join("\n"), input.resolve);
  const options = sharedOptions(input);
  const ambient = [...input.ambient, PROBE_MODULE];
  while (asked.size > 0) {
    const exports = new TextEncoder().encode(
      [...asked].map((name) => `export const ${name} = 0;`).join("\n"),
    );
    try {
      compile({
        ...options,
        ambient,
        resolve: (path) => (path === PROBE_MODULE ? exports : program(path)),
      });
      break;
    } catch (error) {
      const name = exportedTwice(error);
      if (name === undefined || !asked.has(name)) {
        for (const rest of asked) found.add(rest);
        break;
      }
      found.add(name);
      asked.delete(name);
    }
  }

  return found;
}

/** The name the compiler refused for being exported by two ambient modules, if it refused one. */
function exportedTwice(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  // The rendered report sets the rule in bold: its escapes are not part of the words.
  // eslint-disable-next-line no-control-regex
  return EXPORTED_TWICE.exec(error.message.replace(/\u001b\[[0-9;]*m/g, ""))?.[1];
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
    ...sharedOptions(input),
    resolve: makeResolve(input.source, input.resolve),
    ...(input.args === undefined ? {} : { args: [...input.args] }),
  });

  const compiled: RsCompileResult = {
    bytecode: [result.bytecode],
    warnings: [],
    entryEncoding: result.entryEncoding,
    entryParams: result.entryParams,
    entrySignature: entrySignatureOf(result.entrySignature),
  };
  if (result.manifest !== undefined) compiled.manifest = result.manifest;

  return compiled;
}
