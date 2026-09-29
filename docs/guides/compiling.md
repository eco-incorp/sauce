# Compiling programs

[Documentation](../README.md) · [Compiler API](../api/compiler.md) · [SauceScript](../concepts/saucescript.md)

There are two ways to compile, and the choice is about who resolves names. Either way the compiler
is already in this package, and the output is a program a Sauce engine runs, not a contract you
deploy.

Use the **route path** when the program is part of an Eco intent and should say `USDC` and
`Uniswap.UniversalRouter`: the SDK resolves those against the destination chain and hands you a
ready-made call. Use the **raw compiler** when you want a reusable program that takes values at
execution time, a Solana account manifest, or full control over module resolution.

| Entry point                                                         | You supply                                                  | The SDK supplies                                                                                   |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Base(body, options)` / `routes.openRoute(...)`                     | Body and intent options                                     | Chain defines, the ambient token module, registry rewrites, the EVM Pot and engine, a built intent |
| `routes.compileSauceRoute(destination, source, execution, options)` | Source, destination, execution settings                     | Registry rewrites, token defines, one encoded route call                                           |
| `compile({ target, resolve, ... })`                                 | All source and dependency resolution, and compiler settings | Nothing — you get the compiler's own result                                                        |

Bare `USDC`, `Token(address)` and protocol members only exist on the route path. There,
`USDC.approve(Uniswap.UniversalRouter, 1_000_000n)` becomes an ERC-20 ABI import and
`IERC20.at(USDC).approve(<the router's Base address>, 1_000_000n)`, with `USDC` defined as Base's
USDC. Raw `compile()` expects you to write that yourself.

## Compile an EVM route

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

The destination selects the registry addresses. The result has one entry in `calls` and the program
in `compiled.bytecode[0]`; read `source` to see exactly what the rewrites produced.

The call's `value` is the Kitchen fee plus whatever native the program itself spends — this approval
spends none. For Portal fulfillment the Pot must be owned by the destination Portal's Executor and
`route.nativeAmount` must cover every call value. [Create an intent](intents.md) covers reading the
fee, deriving that Pot, and adding the reward and Portal calldata.

`compileSauceRoute` takes a bare body or a complete `function main(...)`. Its rewrite passes parse
the body as JavaScript, so a body carrying SauceScript type annotations belongs in raw `compile`,
which accepts typed source directly.

## Compile a reusable program

A program compiled this way has no values baked into it. Change the amounts and you do not
recompile — which is what makes one program hash cover every execution.

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

console.log(artifact.entryEncoding); // "abi-v1"
```

### Pass arguments with ABI-v1

Encode `main`'s arguments in declaration order and append them to the program. There is no function
selector: entry arguments are not a contract call.

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
// Send it from the Pot owner with value = executionFee + native the program spends.
```

That whole payload is the `program` argument to `Pot.cook(engine, program)`; the cook call itself is
an ordinary contract call with its own ABI encoding. Passing those same values as `defines` instead
would produce a _different_ program — one specialised to them.

### Pass arguments with compact-v1

Compile with `compactArgs: true` and use the schema that comes back with it. The schema and the
bytecode belong to the same artifact; do not pair one with another.

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

Compact encoding is usually smaller for scalars and collections. The two formats are not
interchangeable: a compact program does not accept an ABI-v1 tail, and the reverse is equally true.
Either way, contract calls the program _makes_ still use their own contract ABIs — this is about
getting values into `main`, nothing else.

### Return values an ABI decoder can read

`entryEncoding` describes inputs. Outputs are yours to encode:

```ts
function main(): bytes {
  return abi.encode([1n, 2n, 3n]);
}
```

Decode that as a single `uint256[]` with viem's `decodeAbiParameters`. It is 160 bytes — an offset, a
count, three values. The Pot returns those bytes directly; there is no extra ABI `bytes` wrapper
around them. Returning a raw array instead gives you packed words with no offset or count, which a
generic decoder will not read, so encode explicitly whenever a caller depends on the shape. Solana
has no `abi.encode`.

## Resolve source modules and ABIs

A resolver is synchronous and returns bytes. Return `undefined` for a candidate that does not exist —
that is how the compiler probes a target-specific arm before falling back. Throw when a file that
_does_ exist cannot be read, so the failure is not mistaken for absence.

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

This resolver reads the filesystem; it is not a sandbox. If your application compiles programs
somebody else wrote, serve them from an allowlisted in-memory map instead. Fetch anything remote
_before_ compiling — the resolver cannot await.

For an ABI you already hold, raw compilation takes
`inlineContracts: [["ERC20", JSON.stringify(abi)]]`. The route API takes the parsed form,
`contracts: { ERC20: { abi } }`, and adapts it. The two shapes are not interchangeable.

Raw compilation serves nothing you do not. The route path serves the SDK's own files itself: the
`@sauce/token` library, the ERC-20 and Sauce Router ABIs and every protocol ABI twin. For a raw
compile that needs them, fall back to `resolveSdkModule` and `resolveSdkPackage` from
`@eco-incorp/sauce/compiler` — the [compiler reference](../api/compiler.md#the-sdks-own-modules)
shows how.

The filesystem resolver above is the one Node-only part of this page. In a browser, serve modules
from memory.

## Compile in a browser

Everything on this page runs in a browser and compiles the same bytes as Node. The compiler's
WebAssembly loads asynchronously there, so call `ready()` once before the first compile:

```ts
import { ready } from "@eco-incorp/sauce";

await ready();
```

With no argument it fetches the wasm from beside the compiler's module, which is where a bundler
that handles `new URL(…, import.meta.url)` puts it. Otherwise pass the wasm's URL or bytes. The
[compiler reference](../api/compiler.md#in-a-browser) covers both, and the one subpath that stays
Node-only.

## Compile for Solana

`target: "svm"` returns an account manifest alongside the bytecode:

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

`amount` is the one compact field; `vault` is attached at account slot 0. Resolve and attach accounts
in manifest order with the SVM helpers. The manifest records what the _author_ declared — it does not
discover an account's address, balance, owner or existence.

To run a larger program, stage its bytes through the Kitchen, finalize the code account, then execute.
Keep the raw compilation result: the route path drops the manifest. The
[Solana guide](solana.md) has the full flow.

## Keep compilation reproducible

Store the compiler version, target, source and dependency bytes, ABIs, defines, ambient modules,
optimization setting and argument format alongside any artifact you keep. Keep request arguments out
of the code cache, and hash the final code-plus-arguments payload when you commit to one execution.

The compiler caches its own work between calls as an optimization; `cache: false` forces fresh
lowering. That cache is not an application-level artifact store — if your resolver's inputs change,
refresh them yourself.

For the canonical settle programs, use the shipped recipe source and the pinned verification surface
in [settlement verification](verification.md).
