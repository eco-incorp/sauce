# Compiler API

[Documentation](../README.md) · [Compiling programs](../guides/compiling.md)

`@eco-incorp/sauce/compiler` is the SauceScript compiler and the codec for its compact
argument format. Both ship with the SDK; there is nothing extra to install.

```ts
import {
  compile,
  encodeCompactArguments,
  decodeCompactArguments,
  type CompileOptions,
  type CompileResult,
} from "@eco-incorp/sauce/compiler";
```

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
- `isaRevision` labels the instruction set this artifact was built for. Record it
  with the artifact and run the program on an engine built for the same one; it is
  a label, not a check against any deployed address.
- `entryEncoding` selects the argument encoder: ordinary ABI arguments by
  default, compact arguments when `compactArgs: true`. It does not describe
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

## Node, browsers, and compiler-only features

The SDK requires Node **24 or newer**. Its `/compiler` export loads the compiler
through Node's `createRequire`; SDK route compilation also uses filesystem and
path APIs. These integrations are Node APIs.

The underlying compiler package separately supplies Node and browser builds.
For a browser application, install `@eco-incorp/sauce-compiler` directly and use
its initialization API:

```ts
import { ready } from "@eco-incorp/sauce-compiler/ready";

const { compile } = await ready();
// Supply source/dependencies through synchronous in-memory resolvers.
```

`ready()` initializes the browser WASM build and is a no-op for the already
initialized Node build. Arrange for the compiler's WASM asset and dependency
bytes to be available before compiling. This does not provide the SDK's route
rewrites or registry resolver in a browser.

The compiler package also exports `clearFunctionCache()` and `functionCacheStats()`
for inspecting its internal lowering cache. The SDK's `/compiler` export does not
re-export those or `ready()`; an application that wants them declares the compiler
as a direct dependency and imports from its own package name.
