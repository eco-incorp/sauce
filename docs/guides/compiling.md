# Compiling programs

**How-to guide** · [Documentation](../README.md) · [Compiler API](../api/compiler.md) · [SauceScript](../concepts/saucescript.md)

> Compiling turns your program into the compact code the chain runs, like translating a recipe into
> the cook's shorthand. `sauce compile` does it from a terminal. This page does it from your app, in
> TypeScript, and shows how to hand a compiled program its inputs.

This page is for a TypeScript developer who has done [Sauce from TypeScript](typescript-quick-start.md)
and can write a program ([Write your first program](write-your-first-program.md)). Each section
compiles one kind of program. Install the package and viem in your project first:

```sh
npm install @eco-incorp/sauce viem
```

The compiler is already in the package, and the output is a program a Sauce engine runs, not a
contract you deploy. Two entry points compile, and they differ in who resolves names such as
`USDC` and `Uniswap.UniversalRouter`:

| Entry point                                           | You supply                                                  | The SDK supplies                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `routes.compileSauceProgram(chain, source, options?)` | A program file's text and the chain                         | The chain's names, `@sauce/token`, `main`'s parameters; what `sauce compile` runs |
| `compile({ target, resolve, ... })`                   | All source and dependency resolution, and compiler settings | Nothing: you get the compiler's own result                                        |

The first resolves names for one chain. The second, the raw compiler, resolves nothing: reach for
it when you want full control over modules, compact arguments, or a Solana account manifest you
declare yourself.

Bare `USDC`, `Token(address)` and protocol members such as `Uniswap.UniversalRouter` exist only in
the first. There, `USDC.approve(Uniswap.UniversalRouter, 1000000)` becomes a call to
`@sauce/token`'s `approve`, with `USDC` and the router as the chain's addresses. Every token write
the SDK emits follows OpenZeppelin's `SafeERC20`; [Safety](../concepts/safety.md) explains what
that checks. With raw `compile()` you write those calls yourself, resolving `@sauce/token` with
`resolveSdkPackage`.

## Compile a program for a chain

`routes.compileSauceProgram` compiles a program file for one chain, exactly as `sauce compile`
does:

```ts
import { readFileSync } from "node:fs";
import { routes } from "@eco-incorp/sauce";

const program = routes.compileSauceProgram("base", readFileSync("pay.sauce.ts", "utf8"));

console.log(program.entryParams); // [{ name: "to", type: "Address" }, { name: "amount", type: "Uint256" }]
console.log(program.bytecode.length); // the compiled program's size in bytes
```

The result carries:

- `bytecode`: the program. `Pot.cook(engine, program)` runs it, with `main`'s arguments after it.
- `entryParams`: what `main` takes. `routes.encodeEntryArguments(program, values)` encodes values
  for them, checked against their types, as `--args` does.
- `entryEncoding`: `"abi-v1"`, or `"compact-v1"` when you pass `compactArgs: true`.
- `manifest` and `derivedAccounts` on Solana: the accounts to attach, and those the SDK added.

`options.args` binds `main`'s arguments into the program as it compiles. The program then takes no
arguments when it runs.

[Sauce from TypeScript](typescript-quick-start.md) turns this result into a cook and simulates it.

## Encode a program's inputs

A program that takes its inputs as `main`'s parameters compiles once. `routes.encodeEntryArguments`
then encodes each call's values, checked against their types:

```ts
import { routes } from "@eco-incorp/sauce";

export function buildApprovalProgram(chain: routes.ChainRef) {
  const program = routes.compileSauceProgram(
    chain,
    `function main(amount: Uint256) {
  USDC.approve(Uniswap.UniversalRouter, amount);
}`,
  );
  // `bytecode` is the program; `encodeEntryArguments` encodes `amount`, checked against its type.
  const args = routes.encodeEntryArguments(program, [1_000_000n]);
  return { program, args };
}

const { program, args } = buildApprovalProgram("base");
console.log("bytecode:", program.bytecode.length, "bytes; arguments:", args.length, "bytes");
```

The chain selects the registry addresses; read `program.source` to see exactly what the SDK's
rewrites produced. The cook runs the bytecode with the encoded arguments after it, on your Pot. Its
`value` is the Kitchen fee plus whatever native coin the program itself spends; this approval
spends none.

`compileSauceProgram` takes a SauceScript file as written: a module declaring `function main(...)`,
or a script whose top-level statements are the entry. Its rewrites parse SauceScript as the
compiler does, type annotations included, so a typed helper that takes or returns an array or a
record compiles the same way as through the raw compiler.

## Compile a reusable program

A program compiled with the raw compiler has no values baked into it. Change the amounts and you do
not recompile, which is what makes one program hash cover every execution.

```ts
import { compile } from "@eco-incorp/sauce/compiler";

const source = `
function main(amounts: Uint256[], minimum: Uint256): Uint256 {
  let total = 0;
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
an ordinary contract call with its own ABI encoding. Fixing those same values at compile time
instead, with `options.args` of `routes.compileSauceProgram`, would produce a _different_ program,
one specialised to them.

One parameter type differs from `abi.encode`. `main` reads each parameter from one 32-byte head
word, so a tuple parameter, such as `leg: { amount: Uint256, to: Address }`, sits behind an offset
word even when all its fields are fixed-size. `encodeAbiParameters` writes such a tuple's fields
inline instead, and `main` would read the wrong values. Inside a parameter, as an array element or a
field of another tuple, a fixed-size tuple is inline, as `abi.encode` writes it.
`routes.encodeEntryArguments` encodes arguments in the layout `main` reads, from the parameters
`main` declares, and `routes.decodeEntryArguments` reads them back.

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
Either way, contract calls the program _makes_ still use their own contract ABIs: this is about
getting values into `main`, nothing else.

### Return values an ABI decoder can read

`entryEncoding` describes inputs. What `main` returns comes back as raw bytes, by its declared
type:

| `main` returns                 | The bytes                                             |
| ------------------------------ | ----------------------------------------------------- |
| `Address`, `Uint256` or `bool` | One 32-byte word                                      |
| A record                       | Its fields, one word each                             |
| An array                       | Its elements, one word each, with no offset or length |
| `bytes`                        | The bytes themselves                                  |
| nothing (`void`)               | Nothing                                               |

So a raw array is not what an ABI decoder reads. Encode explicitly whenever a caller depends on the
shape:

```js
function main(): bytes {
  return abi.encode([1, 2, 3]);
}
```

Decode that as a single `uint256[]` with viem's `decodeAbiParameters`. It is 160 bytes: an offset,
a count, three values. The Pot returns those bytes directly; there is no extra ABI `bytes` wrapper
around them. Solana has no `abi.encode`.

## Resolve source modules and ABIs

A resolver is synchronous and returns bytes. Return `undefined` for a candidate that does not exist:
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
_before_ compiling: the resolver cannot await.

For an ABI you already hold, raw compilation takes
`inlineContracts: [["ERC20", JSON.stringify(abi)]]`. `compileSauceProgram` takes the parsed form,
`contracts: { ERC20: { abi } }`, and adapts it. The two shapes are not interchangeable.

Raw compilation serves nothing you do not. `compileSauceProgram` serves the SDK's own files
itself: the `@sauce/token` and [`@sauce/router`](../api/router.md) libraries, the ERC-20 and
Sauce Router ABIs and every protocol ABI twin. For a raw compile that needs them, fall back to
`resolveSdkModule` and `resolveSdkPackage` from `@eco-incorp/sauce/compiler`; the
[compiler reference](../api/compiler.md#the-sdks-own-modules) shows how.

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
[compiler reference](../api/compiler.md#in-a-browser) covers both, and the subpaths that stay
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
in manifest order with the SVM helpers. The manifest records what the _author_ declared: it does not
discover an account's address, balance, owner or existence.

To run a larger program, stage its bytes through the Kitchen, finalize the code account, then
execute. [Solana from TypeScript](solana-from-typescript.md) has the full flow.

## Keep compilation reproducible

Store the compiler version, target, source and dependency bytes, ABIs, compile-time values, ambient
modules, optimization setting and argument format alongside any artifact you keep. Keep request
arguments out of the code cache, and hash the final code-plus-arguments payload when you commit to
one execution.

The compiler caches its own work between calls as an optimization; `cache: false` forces fresh
lowering. That cache is not an application-level artifact store: if your resolver's inputs change,
refresh them yourself.

## Next

- Turn a compiled program into a cook and simulate it: [Sauce from TypeScript](typescript-quick-start.md).
- Every option of `compile()` and its result: the [compiler reference](../api/compiler.md).
- Check that a settlement program is the audited one: [settlement verification](verification.md).
