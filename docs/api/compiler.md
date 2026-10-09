# Compiler API

[Documentation](../README.md) · [Compiling programs](../guides/compiling.md)

`@eco-incorp/sauce/compiler` is the SauceScript compiler and the codec for its compact
argument format. Both ship with the SDK; there is nothing extra to install. It runs in
Node and in a browser; in a browser, [`await ready()`](#in-a-browser) first.

This SDK pins compiler **2.5.0**, EVM engine/Kitchen **1.2.0**, SVM engine **1.3.0**, and SVM Kitchen
**1.0.0**. Deploy the matching stack before using the release defaults on-chain. Existing EVM Pots
from Kitchen 1.1.0 retain their old bytecode and require their previous engine and SDK pairing.

```ts
import {
  compile,
  ready,
  encodeCompactArguments,
  decodeCompactArguments,
  resolveSdkModule,
  resolveSdkPackage,
  type CompileOptions,
  type CompileResult,
} from "@eco-incorp/sauce/compiler";
```

This SDK pins one compiler and the four v12 releases its output runs on: the EVM
engine and Kitchen, and the SVM engine and Kitchen. `v12ReleaseSet()` names them —
see [Which engine runs a program](#which-engine-runs-a-program). Release addresses
identify this compatible set; they do not confirm it has been deployed on a chain.
Check deployment readiness before using it live.

Every example here is checked against the compiler version this package ships.

## `compile(options): CompileResult`

Compilation is synchronous. The host supplies source and dependency bytes through
callbacks; the compiler does not fetch a filesystem path or network URL itself.

```ts
const source = new TextEncoder().encode(`
  function main(amount: Uint256): Uint256 {
    return amount + 1n;
  }
`);

const artifact = compile({
  target: "evm",
  entry: "main.ts",
  resolve: (path) => (path === "main.ts" ? source : undefined),
});

console.log(artifact.bytecode.length, artifact.entryEncoding);
```

### Options

| Field             | Type                                                   | Meaning                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `target`          | `"evm" \| "svm"`                                       | Required target runtime                                                                                                                                                                                                                                                                                                        |
| `resolve`         | `(path: string) => Uint8Array \| undefined \| null`    | Required synchronous module/JSON resolver                                                                                                                                                                                                                                                                                      |
| `entry`           | `string`                                               | Entry module; default `"main.js"`                                                                                                                                                                                                                                                                                              |
| `resolvePackage`  | `(specifier, importer) => string \| undefined \| null` | Map a bare package specifier to a path understood by `resolve`                                                                                                                                                                                                                                                                 |
| `contracts`       | `[name, path][]`                                       | Register entry-module ABI bindings by resolver path                                                                                                                                                                                                                                                                            |
| `inlineContracts` | `[name, abiJson][]`                                    | Register entry-module ABI bindings from JSON strings                                                                                                                                                                                                                                                                           |
| `ambient`         | `string[]`                                             | Resolve libraries and broadcast their exports into every module                                                                                                                                                                                                                                                                |
| `defines`         | `[name, value][]`                                      | Program-wide scalar compile-time constants; values are integer strings                                                                                                                                                                                                                                                         |
| `optimize`        | `boolean`                                              | Enable compiler optimizations; default `true`                                                                                                                                                                                                                                                                                  |
| `compactArgs`     | `boolean`                                              | Use compact-v1 entry arguments; default `false`                                                                                                                                                                                                                                                                                |
| `args`            | `ArgValue[]`                                           | `main`'s arguments to compile the program for, in `entryParams` order, each read as its parameter reads it: a word (`bigint`, `boolean`, decimal or `0x` string), `bytes` (`Uint8Array` or `0x` hex), a string, an array, or a record (its fields in order, or an object of them by name); `entryParams` then comes back empty |
| `cache`           | `boolean`                                              | Enable the per-function lowering cache; default `true`                                                                                                                                                                                                                                                                         |

`optimize: false` turns the optimizer off. Every check the compiler performs still
runs; you get a larger, more literal program.

`defines` accepts decimal or `0x` integer strings, with supported literal
separators and an optional trailing `n`. Use strings so the JavaScript host does
not round 256-bit values. A repeated name is an error. A define replaces a
module's same-named `const`; incompatible declarations, such as a module-level
`let` or a function, are errors. Function-local declarations can shadow it.

An ambient export yields to a module's own declarations, imports, and bindings.
Two ambient modules exporting the same name are an error. Ambient libraries must
be resolvable SauceScript modules and cannot supply an entry `main`.

### Resolver contract

Return bytes for an existing module. Return `undefined` or `null` for a missing
candidate; this lets resolution try a neutral module when a target-specific arm
does not exist. Throw when resolving an existing resource fails and compilation
must stop. The compiler propagates that failure rather than treating it as a
missing arm.

Paths can retain `./`, and dependencies are resolved in the importing module's
context. An in-memory map must serve the paths actually requested. A filesystem
resolver can resolve candidates relative to a known root. Serve JSON bytes as
well as source bytes: bare JSON imports denote ABIs, while
`with { type: "json" }` imports JSON data.

For a package with a neutral entry such as `token.js`, resolution can probe
`token.evm.js` or `token.svm.js` according to the target. Supply the neutral
specifier and let the compiler select the arm.

### The SDK's own modules

`resolveSdkModule(path)` and `resolveSdkPackage(specifier)` serve the files the SDK
ships, from memory, with the contracts above: the `@sauce/token` and
[`@sauce/router`](router.md) libraries, the `./artifacts/IERC20.json` and
`./artifacts/ISauceRouter.json` ABIs, and every protocol ABI as
`./protocols/<slug>/<Export>.json`. Fall back to them from your own resolver to compile
a program the SDK's builders emit, or one that imports either library:

```ts
const entry = new TextEncoder().encode(`
  import { balanceOf } from "@sauce/token";
  function main(token: Address, account: Account): Uint256 {
    return balanceOf(token, account);
  }
`);

const artifact = compile({
  target: "evm",
  entry: "main.ts",
  resolve: (path) => (path === "main.ts" ? entry : resolveSdkModule(path)),
  resolvePackage: resolveSdkPackage,
});
```

### Result

```ts
interface CompileResult {
  bytecode: Uint8Array;
  isaRevision: "stack-compact-v2";
  entryEncoding: "abi-v1" | "compact-v1";
  entrySchema?: Uint8Array;
  manifest?: AccountManifest;
}
```

- `bytecode` is one reusable program. Per-execution argument values have not been
  appended.
- `isaRevision` labels the instruction set this artifact was built for. It is a
  label, not a compatibility check: two engine releases can report the same
  revision while only one of them runs a given compiler's output. Pair a program
  with an engine by exact package version — see
  [Which engine runs a program](#which-engine-runs-a-program).
- `entryEncoding` selects the argument encoder: ABI arguments by default, with
  every tuple parameter behind an offset
  ([Pass arguments with ABI-v1](../guides/compiling.md#pass-arguments-with-abi-v1)),
  compact arguments when `compactArgs: true`. It does not describe
  [program return encoding](../guides/compiling.md#return-values-an-abi-decoder-can-read).
- `entrySchema` describes compact argument structure. Pass this exact schema to
  the compact codec; do not infer or rebuild it from example bytes.
- `manifest` is present for SVM and describes attached accounts. It is absent
  for EVM.

Compilation and resolution failures throw. A source diagnostic carries a location
and span; an error about an option, a resolver or a feature the target lacks has
nothing to point at. A message thrown by your own resolver is preserved. There is
no success-with-warnings result to inspect — if `compile()` returns, it worked.

### SVM account manifest

`AccountManifest.accounts` contains these entries:

```ts
type AccountEntry =
  | {
      kind: "slot";
      index: number;
      name: string;
      requires: "readonly" | "writable" | "readonly_signer" | "writable_signer";
    }
  | { kind: "remaining"; from: number };
```

Slots correspond to `main`'s `Account` parameters. Their roles are declarations
made by the author, not permissions inferred by examining a CPI callee. A
`remaining` entry marks the start of the variable account tail when the source
uses it. SVM `Account` parameters do not occupy compact argument fields.

The subpath also exports `AccountEntry`, `AccountManifest`, `AccountRole`,
`CompileOptions`, `CompileResult`, `ResolveModule`, `ResolvePackage`, and
`SauceTarget` as types from the compiler package.

### Which engine runs a program

Compiler output and v12 engines pair by exact package version, in both
directions: a compiler's programs run only on the engine releases its row names,
and an engine runs only the output of the compiler its row names. A new compiler
release can change the instructions it emits for the same source, so an engine
from an earlier row can misread its programs, and an earlier compiler's programs
can fail on a newer engine. `V12_RELEASE_SETS` (from
`@eco-incorp/sauce/deployments`) holds one row per compiler version: the four v12
releases that compiler pairs with, each asset's digest, and each engine's
address or program id. The SDK pins one compiler and ships the engines of that
compiler's row, so `v12EngineAddress()` and `v12SvmEngineProgramId()` always
name engines that run the SDK's own programs.

Every SDK builder that names an engine — `v12Pot.encodeCook`,
`routes.buildSauceEvmCall`, the SVM engine instructions and the Kitchen cook
instructions — calls `assertEngineRunsCompiler(target, engine)` first. It throws
for an engine a release set names for another compiler, saying which engine
this compiler's output needs instead. An engine no release set names, such as
one you deployed yourself, is not refused: the SDK cannot tell what it is.

```ts
import { assertEngineRunsCompiler, v12ReleaseSet } from "@eco-incorp/sauce/deployments";

const set = v12ReleaseSet(); // this SDK's compiler and the four releases it pairs with
console.log(set.compiler, set["v12-evm"].version, set["v12-svm"].version);
assertEngineRunsCompiler("evm", set["v12-evm"].engine!); // passes: the pinned engine
```

`v12ReleaseSet(compiler)` returns another compiler's row, and throws for a
compiler no row pairs with. When you run programs from a different compiler
version than the SDK's, pass that version as the third argument:
`assertEngineRunsCompiler("evm", engine, compiler)`.

## Compact argument codec

```ts
encodeCompactArguments(
  schema: Uint8Array,
  value: CompactValue,
  options?: { scalarWidth?: number },
): Uint8Array;

decodeCompactArguments(
  schema: Uint8Array,
  data: Uint8Array,
  options?: { maxValues?: number; scalarWidth?: number },
): CompactValue;
```

`CompactValue` accepts `bigint`, safe integer `number`, `boolean`, integer or hex
`string`, `Uint8Array`, and recursively nested positional arrays.

For a compiled entry, the root value is an array containing its arguments in
declaration order. Omit `Account` parameters only on SVM, where accounts are
attached separately; EVM `Account` parameters are encoded as scalars. For
`main(account: Account, amount: Uint256)`, pass `[account, amount]` on EVM and
`[amount]` on SVM. Nested records are positional arrays too.
`bytes` values accept a `Uint8Array` or an even-length `0x` hex string. Scalar
addresses/public keys are integers or hexadecimal integers; base58 public-key
text is not a scalar encoding.

A negative integer keeps its 256-bit two's-complement pattern, and the decoder
returns every scalar as an unsigned `bigint` — it has no way to know you meant a
signed type, so convert at your own boundary.

Encoding is canonical: one value, one byte string. The decoder enforces that, and
rejects a padded scalar, a non-canonical boolean, a malformed length or trailing
data. `maxValues` bounds the decoded object graph and defaults to `1_000_000`.
A schema may be at most 65,535 bytes and 32 levels deep.

`scalarWidth` fixes every scalar at a declared width of 1–32 bytes instead of the
smallest that fits. The payload stays canonical — still exactly one encoding per
value — but its **length stops depending on the values**, which is what lets a
caller write a number into an already-built payload at a known offset. Pass the
same width to both functions; a decode without it rejects the padded form, and a
decode with it rejects the minimal one. A value too wide for the declared width is
rejected rather than truncated.

Encoding successfully says nothing about whether the payload fits a transaction or
the engine's own execution limits. And compact-v1 is about **entry arguments only**:
contract calls the program makes still use their contract ABIs.

## Raw compiler versus route compilation

`routes.compileSauceRoute()` is a separate SDK API with a source string,
destination, execution settings, and `SauceCompileOptions`. It supplies registry
rewrites and call encoding. Its result is:

```ts
{
  calls: readonly CallInput[];
  compiled: { bytecode: Uint8Array[]; warnings: string[] };
  source: string;
}
```

There is one compiled segment and one route call. `source` is the SDK-rewritten
program; the internal compiler adapter can additionally annotate a falling-through
`main` as `void`. `warnings` is always empty — a compilation failure throws.

The route adapter keeps neither the entry schema nor the SVM manifest, and its
options do not expose `compactArgs`, `cache` or `optimize`. Use raw `compile()`
when you need any of those, runtime entry parameters, or full resolver control.
Route `target: "v1"` and `"v12"` both select the EVM backend.

See [routes](routes.md) for the route-specific API.

## In a browser

The SDK compiles in a browser exactly as it does in Node: raw `compile()`, route
compilation (`Base.hop(…).then(...)`, `compileSauceRoute`), the builders, the
recipes and `/actions` produce the same bytes in both. The difference is start-up.
Node instantiates the compiler's WebAssembly as the package loads; a browser has to
fetch it, which cannot happen synchronously. Call `ready()` once, before the first
compile:

```ts
import { ready } from "@eco-incorp/sauce/compiler"; // also exported by "@eco-incorp/sauce"

await ready();
// compile(), compileSauceRoute(), Base.hop(…).then(...) and compileProgram() are now
// synchronous, as in Node.
```

Until `ready()` resolves, every compile throws an error saying to await it. In Node
it resolves at once and no compile needs it, so code shared by both can always call
it. Calling it again is harmless, and a failed attempt is not remembered: calling
again retries.

With no argument, `ready()` loads the compiler package's `web/sauce_wasm_bg.wasm`
through `new URL("sauce_wasm_bg.wasm", import.meta.url)`, relative to the compiler's
own module. A bundler that rewrites `new URL(…, import.meta.url)` asset references
emits the file and points the URL at it. With one that does not — esbuild, for
example — copy the file next to your bundle, or tell `ready()` where it is: a URL,
or the bytes themselves.

```ts
await ready(new URL("/assets/sauce_wasm_bg.wasm", location.href));
// or
await ready(await (await fetch("/assets/sauce_wasm_bg.wasm")).arrayBuffer());
```

The first `source` that succeeds is the one used; the compiler warns if a later call
passes a different one.

Every subpath works in a browser except `/svm/engine-artifacts`. It returns filesystem
paths to the packaged engine binaries for a local LiteSVM harness, and is Node-only.
In Node, the SDK requires Node **24 or newer**.

## Compiler-only features

The compiler package also exports `clearFunctionCache()` and `functionCacheStats()`
for inspecting its internal lowering cache. The SDK's `/compiler` export does not
re-export those; an application that wants them declares the compiler as a direct
dependency and imports from its own package name.
