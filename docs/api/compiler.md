# Compiler API

**Reference** · [Documentation](../README.md) · [Compiling programs](../guides/compiling.md)

> The compiler is the translator: it takes your program's text and turns it into the bytecode the
> chain runs. This page is its exact interface for TypeScript: every option you can pass, and
> everything it gives back.

This page is for a TypeScript developer who calls the compiler directly: a build tool, a server
that compiles programs, or a test. It assumes you have written a SauceScript program
([Write your first program](../guides/write-your-first-program.md)). To compile a program for one
chain by name, with its tokens and protocols resolved for you, the
[compiling guide](../guides/compiling.md) is the shorter path.

`@eco-incorp/sauce/compiler` is the SauceScript compiler and the codec for its compact
argument format. Both ship with the SDK; there is nothing extra to install. It runs in
Node and in a browser; in a browser, [`await ready()`](#in-a-browser) first.

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

Each SDK release pins one compiler version and the engine and Kitchen releases its output runs on.
The [changelog](../changelog.md) records which versions each SDK release pins, and
[Deployments](../reference/deployments.md) lists the current set and its addresses. A recorded
address does not confirm that the release is deployed on a chain: check that the code is there
before you use it live. [Which engine runs a program](#which-engine-runs-a-program) explains the
pairing.

The examples on this page use the compiler this package ships.

## `compile(options): CompileResult`

Compilation is synchronous. The host supplies source and dependency bytes through
callbacks; the compiler does not fetch a filesystem path or network URL itself.

```ts
const source = new TextEncoder().encode(`
  function main(amount: Uint256): Uint256 {
    return amount + 1;
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

| Field             | Type                                                   | Meaning                                                                |
| ----------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `target`          | `"evm" \| "svm"`                                       | Required target runtime                                                |
| `resolve`         | `(path: string) => Uint8Array \| undefined \| null`    | Required synchronous module/JSON resolver                              |
| `entry`           | `string`                                               | Entry module; default `"main.js"`                                      |
| `resolvePackage`  | `(specifier, importer) => string \| undefined \| null` | Map a bare package specifier to a path understood by `resolve`         |
| `contracts`       | `[name, path][]`                                       | Register entry-module ABI bindings by resolver path                    |
| `inlineContracts` | `[name, abiJson][]`                                    | Register entry-module ABI bindings from JSON strings                   |
| `ambient`         | `string[]`                                             | Resolve libraries and broadcast their exports into every module        |
| `defines`         | `[name, value][]`                                      | Program-wide scalar compile-time constants; values are integer strings |
| `optimize`        | `boolean`                                              | Enable compiler optimizations; default `true`                          |
| `compactArgs`     | `boolean`                                              | Use compact-v1 entry arguments; default `false`                        |
| `chain`           | `string`                                               | The chain the program runs on: a key of `chainProfiles`                |
| `chainProfiles`   | `Record<string, ChainProfile>`                         | Each chain's builtin profile, keyed by a chain key you choose          |
| `cache`           | `boolean`                                              | Enable the per-function lowering cache; default `true`                 |

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

### Chain profiles

A target is a virtual machine, and two EVM chains can run the same engine while a builtin behaves
differently on them: a chain with no blobs has no blob base fee to report. A chain profile tells the
compiler what one chain does with such a builtin, so the program is compiled for that chain.

```ts
const source = new TextEncoder().encode(`
  function main(): Uint256 {
    return ctx.prevrandao();
  }
`);

const artifact = compile({
  target: "evm",
  entry: "main.ts",
  resolve: (path) => (path === "main.ts" ? source : undefined),
  chain: "base",
  chainProfiles: {
    base: { builtins: { "ctx.prevrandao": { constant: "0" } } },
    arbitrum: { name: "Arbitrum", builtins: { "ctx.prevrandao": "unsupported" } },
  },
});

console.log(artifact.chain); // "base"
```

A `ChainProfile` is `{ name?: string; builtins?: Record<string, "unsupported" | { constant: string }> }`:

- A key of `builtins` is a builtin's source spelling, such as `"ctx.prevrandao"` or `"evm.create2"`.
  Only a builtin whose behaviour depends on the chain can be named. A typo, or a portable read such
  as `ctx.timestamp`, is a compile error.
- `"unsupported"` makes any use of the builtin a compile error, naming the chain
  (`` `ctx.prevrandao()` is not available on Arbitrum ``), instead of a program that reverts there.
- `{ constant: "0" }` compiles the builtin to that value, as a decimal or `0x` string, and constant
  folding sees through it. It applies only to a builtin that takes no arguments.
- `name` is the chain's name in error messages. Without it, the error names the chain by its key.
- A builtin the profile does not name compiles as it does with no profile.

`chain` and `chainProfiles` go together. A `chain` that has no profile is an error; give a chain
whose builtins all behave as the target's an empty profile, `{}`. Profiles with no `chain` are an
error too. Every profile is checked, whether or not this compile uses it. The keys are yours: a
chain id or a name, whichever your host uses.

The same source can compile to different bytecode on two chains, so the function cache treats each
profile as an input. The SDK's own route compilation and the `sauce` command pass no profile. The
`/compiler` subpath does not re-export the `ChainProfile` type; in TypeScript, write
`NonNullable<CompileOptions["chainProfiles"]>[string]`.

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
  chain?: string;
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
- `chain` echoes the `chain` option, and is absent when the compile named none.
  It tells an artifact built for one chain apart from one built for another.

There is no success-with-warnings result to inspect: if `compile()` returns, it
worked.

### Errors

Compilation and resolution failures throw. The thrown error's `message` is the
full report: the rule that was broken, the source line and a caret under the
span. Its `diagnostics` array places each source error, in source order:

```ts
try {
  compile(options);
} catch (error) {
  const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
  if (Array.isArray(diagnostics)) {
    for (const { path, message, start, end } of diagnostics) {
      console.log(`${path}:${start.line}:${start.column}-${end.line}:${end.column} ${message}`);
    }
  }
  throw error;
}
```

Each entry is `{ path, message, start, end, secondary? }`:

- `path` is the module as `resolve` was asked for it. An error in an imported module names the
  import, not the entry.
- `start` and `end` are `{ offset, line, column }`. Lines and columns start at 1. Every count is in
  UTF-16 code units, the unit a JavaScript string indexes in, so
  `source.slice(start.offset, end.offset)` is the span.
- `secondary`, when present, is a second location with its own note, such as where a name was
  first declared.

An error with no place in the source has an empty `diagnostics` array: an invalid option, a
resolver failure, or a builtin a chain profile refuses. A message thrown by your own resolver is
kept. The error `compile()` throws in a browser before [`ready()`](#in-a-browser) has resolved
carries no `diagnostics` at all, which is why the example checks for the array. The `/compiler`
subpath does not re-export the `CompileError` or `Diagnostic` types.

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
`SauceTarget` as types from the compiler package, and its own `CompactValue` and
`WasmSource`.

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

## Raw compiler versus compiling for a chain

`routes.compileSauceProgram(chain, source, options?)` is the SDK's compile for one
chain by name. It supplies the chain's token symbols, protocol addresses and
`chainId`, the `@sauce/token` functions with no import, and the registry rewrites,
then calls this compiler. Its result keeps the bytecode, the entry encoding and
schema, `main`'s parameters, and the SVM manifest; its `args` option binds `main`'s
arguments into the program.

`routes.compileSauceRoute()` compiles the same way without the chain's ambient
`@sauce/token` functions, and returns the program in a compatibility shape beside
one encoded cook call:

```ts
{
  calls: readonly CallInput[];
  compiled: { bytecode: Uint8Array[]; warnings: string[] };
  source: string;
}
```

There is one compiled segment and one call. `source` is the SDK-rewritten
program; the internal compiler adapter can additionally annotate a falling-through
`main` as `void`. `warnings` is always empty — a compilation failure throws. It
keeps neither the entry schema nor the SVM manifest.

Neither exposes `cache` or `optimize`. Use raw `compile()` when you need either of
those, or full resolver control. SDK target `"v1"` and `"v12"` both select the EVM
backend.

See [Programs and cooks](routes.md) for both, and for the cook builders.

## In a browser

The SDK compiles in a browser exactly as it does in Node: raw `compile()`,
`routes.compileSauceProgram`, the builders, the recipes and `/actions` produce the
same bytes in both. The difference is start-up.
Node instantiates the compiler's WebAssembly as the package loads; a browser has to
fetch it, which cannot happen synchronously. Call `ready()` once, before the first
compile:

```ts
import { ready } from "@eco-incorp/sauce/compiler"; // also exported by "@eco-incorp/sauce"

await ready();
// compile(), routes.compileSauceProgram() and compileProgram() are now synchronous,
// as in Node.
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

Two subpaths do not run in a browser: `/svm/engine-artifacts`, which returns
filesystem paths to the packaged engine binaries for a local LiteSVM harness, and
`/testing`, which starts local chains for tests. Both are Node-only. The
[API reference](README.md#where-each-import-runs) lists where each import runs.

## Compiler-only features

The compiler package also exports `clearFunctionCache()` and `functionCacheStats()`
for inspecting its internal lowering cache. The SDK's `/compiler` export does not
re-export those; an application that wants them declares the compiler as a direct
dependency and imports from its own package name.

## Next

[Programs and cooks](routes.md) compiles a program for one chain by name and builds the cook that
runs it. [Pots and cooks in code](README.md#pots-and-cooks-in-code) lists each step with the
`sauce` command beside it.
