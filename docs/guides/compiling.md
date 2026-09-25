# Compiling programs

[Documentation](../README.md) · [Compiler API](../api/compiler.md) · [SauceScript](../concepts/saucescript.md)

Use the SDK route compiler when a program should become an Eco route call with
chain-scoped token and protocol names. Use the raw compiler when you need a
reusable parameterized program, an SVM account manifest, or explicit compiler
options such as compact arguments.

## Choose a compilation path

| Entry point                                                         | Inputs you supply                                           | What the SDK supplies                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Base(body, options)` / `routes.openRoute(...)`                     | Closure or source, intent options, execution addresses      | Chain defines, default ambient `@sauce/token`, registry rewrites, compilation, intent construction |
| `routes.compileSauceRoute(destination, source, execution, options)` | Source, destination, execution settings                     | Registry rewrites, token defines, compilation, one encoded route call                              |
| `compile({ target, resolve, ... })`                                 | Complete source/dependency resolution and compiler settings | The published compiler result, including entry metadata and SVM manifest                           |

Bare `USDC`, `Token(address)`, and protocol-member calls are resolved by SDK route
rewrites. Raw `compile()` expects compiler-native source, such as
`ERC20.at(address).approve(...)` backed by an ABI import or registered binding.

## Compile an EVM route

This function constructs a call; the caller supplies the deployed Pot,
compatible engine address, and the Kitchen's current execution fee. It submits
no transaction.

```ts
import { routes } from "@eco-incorp/sauce";
import type { Address } from "viem";

export function buildApprovalRoute(pot: Address, engine: Address, executionFee: bigint) {
  return routes.compileSauceRoute("base", "USDC.approve(Uniswap.UniversalRouter, 1_000_000n);", {
    pot,
    engine,
    value: executionFee,
  });
}
```

The destination determines registry addresses. The result contains one entry in
`calls` and the compiled program in `compiled.bytecode[0]`. Inspect `source` to
see the SDK's rewrites. This approval program spends no native token, so its call
value is only the execution fee. A program spending native tokens also needs that
amount in its call value. For Portal fulfillment, the Pot must be owned by the
destination Portal's Executor, and `route.nativeAmount` must cover the call values.
Use [the intent guide](intents.md) to read the fee, derive the correctly owned Pot,
and add source-chain funding, a reward, and Portal publication calldata.

`compileSauceRoute` accepts a bare body or a complete `function main(...)`
program. Keep route source in the JavaScript syntax accepted by its rewrite
passes; use raw `compile` for programs that require SauceScript type annotations.
The raw compiler accepts typed source directly.

## Compile a reusable program

This Node example compiles a program that sums runtime inputs and checks a floor.
All modules are in memory, so it needs no filesystem resolver.

```ts
import { compile } from "@eco-incorp/sauce/compiler";

const source = `
function main(amounts: Uint256[], minimum: Uint256): Uint256 {
  let total = 0n;
  for (let i = 0; i < amounts.length; i = i + 1) {
    total = total + amounts[i];
  }
  require(total >= minimum);
  return total;
}
`;

const entry = new TextEncoder().encode(source);
const artifact = compile({
  target: "evm",
  entry: "main.ts",
  resolve: (path) => (path === "main.ts" ? entry : undefined),
});

console.log(artifact.isaRevision); // "stack-compact-v2"
console.log(artifact.entryEncoding); // "abi-v1"
```

The amount list and minimum have not been supplied yet. Changing those execution
values does not require recompilation.

### ABI-v1 entry arguments

Encode the `main` arguments in declaration order and append them to the compiled
program. Entry arguments have no function selector.

```ts
import { encodeAbiParameters, hexToBytes, bytesToHex } from "viem";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";

const args = hexToBytes(
  encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256" }], [[25n, 75n], 100n]),
);

const payload = new Uint8Array(artifact.bytecode.length + args.length);
payload.set(artifact.bytecode);
payload.set(args, artifact.bytecode.length);

// Given a compatible engine address:
// const data = v12Pot.encodeCook(engine, bytesToHex(payload));
// Send `data` from the Pot owner with value = executionFee + programNativeValue.
```

The same byte payload is the `program` argument to `Pot.cook(engine, program)`;
the outer cook call has its own ordinary contract ABI encoding. Supplying
argument bytes to the compiler as `defines` would produce a different kind of
program, specialized to those values.

### Compact-v1 entry arguments

Compile the same source with `compactArgs: true`, then use the returned schema.
The schema and bytecode belong to the same artifact.

```ts
import {
  compile,
  encodeCompactArguments,
  decodeCompactArguments,
} from "@eco-incorp/sauce/compiler";

const compact = compile({
  target: "evm",
  entry: "main.ts",
  resolve: (path) => (path === "main.ts" ? entry : undefined),
  compactArgs: true,
});

if (compact.entryEncoding !== "compact-v1" || !compact.entrySchema) {
  throw new Error("Expected a compact argument schema");
}

const compactArgs = encodeCompactArguments(compact.entrySchema, [[25n, 75n], 100n]);
const inspected = decodeCompactArguments(compact.entrySchema, compactArgs);
// inspected: [[25n, 75n], 100n]

const compactPayload = new Uint8Array(compact.bytecode.length + compactArgs.length);
compactPayload.set(compact.bytecode);
compactPayload.set(compactArgs, compact.bytecode.length);
```

A compact program requires an engine implementing its ISA revision. It does not
accept an ABI-v1 tail, and an ABI-v1 program does not accept compact arguments.
Compact encoding often reduces scalar and collection payload size, but runtime
heap, compute, and transaction limits still apply. Its format does not change
contract ABI calls performed inside the program.

### Encode EVM return values

`entryEncoding` and `compactArgs` describe inputs only. To return data for a host
ABI decoder, encode it explicitly in SauceScript:

```ts
function main(): bytes {
  return abi.encode([1n, 2n, 3n]);
}
```

Decode that result as one `uint256[]` with Viem's `decodeAbiParameters`. It is
160 bytes: an offset, an element count, and three values. The EVM Pot returns
these bytes directly; do not decode another ABI `bytes` wrapper around them.
This applies with both ABI-v1 and compact-v1 inputs. SVM has no `abi.encode`
builtin.

Compiler 2.3.0 changed raw EVM scalar-array literal returns: `return [1n, 2n, 3n]`
now returns three packed 32-byte values without an ABI offset or count. Compiler
2.2.1 returned heap descriptors for that source. Raw tuple returns still contain
heap descriptors. Recompilation can therefore change observable return bytes;
use explicit `abi.encode` when a caller relies on ABI output.

## Resolve source modules and ABIs

A resolver is synchronous and returns bytes. Missing target-arm candidates must
return `undefined`; unreadable existing files should fail compilation.

```ts
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { compile } from "@eco-incorp/sauce/compiler";

const root = resolvePath("./programs");

const artifact = compile({
  target: "evm",
  entry: "main.ts",
  resolve(path) {
    try {
      return readFileSync(resolvePath(root, path));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return undefined;
      throw error;
    }
  },
});
```

This resolver reads files; it is not an isolation boundary for untrusted source.
Use an allowlisted virtual module map when applications accept user-supplied
programs. Fetch any remote modules before the synchronous compile step.

For an ABI already held in memory, use raw compiler
`inlineContracts: [["ERC20", JSON.stringify(abi)]]`. The route API instead accepts
`contracts: { ERC20: { abi } }` with a parsed ABI and adapts it internally.
Do not pass the route shape to raw `compile()`.

Raw compiler resolution does not automatically locate the SDK's `@sauce/token`
copy. SDK route compilation resolves that package itself. With raw compilation,
provide the package's source and neutral entry mapping through your resolver.

## Compile for SVM

Selecting `target: "svm"` produces an account manifest. For example:

```ts
import { compile } from "@eco-incorp/sauce/compiler";

const source = new TextEncoder().encode(`
  function main(vault: Account, amount: Uint256): Uint256 {
    return amount;
  }
`);

const artifact = compile({
  target: "svm",
  resolve: (path) => (path === "main.js" ? source : undefined),
  compactArgs: true,
});

console.log(artifact.manifest?.accounts);
// [{ kind: "slot", index: 0, name: "vault", requires: "readonly" }]
```

The compact root has one field, `amount`; `vault` is attached at account slot 0.
Resolve and attach accounts in manifest order using the SVM helpers. The manifest
does not discover an account's address, balance, owner, or liveness.

For staged execution, stage the bytes through the Kitchen, finalize the code
account, then use the Kitchen client or instruction builders. The SVM
`routes.compileSauceRoute` path drops the manifest and emits a legacy instruction
incompatible with the released engine. Use raw compilation for account plans
and follow the [Solana execution guide](solana.md).

## Keep compilation reproducible

Record the compiler version, target, ISA revision, source/dependency bytes,
contract ABIs, defines, ambient modules, optimization settings, and argument
format with an artifact. Keep request arguments separate from the code cache;
hash the final code-plus-arguments payload when committing to a particular
execution.

The compiler's function cache is enabled by default. It is an optimization of
lowering, not an application-level bytecode cache or a dependency resolver.
`cache: false` forces fresh lowering. If an application mutates cached resolver
inputs, refresh those inputs and use the compiler package's cache controls as
needed.

For canonical settle programs, use the shipped recipe source and the pinned
verification surface described in [settlement verification](verification.md).
