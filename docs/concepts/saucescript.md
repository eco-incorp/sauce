# Writing SauceScript

[Documentation](../README.md) · [Architecture](architecture.md) · [Compiling](../guides/compiling.md)

> SauceScript is the language you write programs in. It looks like TypeScript, but it is smaller and
> stricter, like a recipe card with a fixed set of words: the compiler checks every line before
> anything runs. Once your program is running on the chain, it cannot ask your app for anything, so
> whatever it needs, you hand it at the start.

SauceScript is a checked subset of TypeScript. It has the familiar things —
variables, functions, conditions, loops, arrays, records — but it does not run in
a JavaScript engine. Your application builds and submits a program; SauceScript is
what the chain then executes, atomically, inside that one transaction.

Most of what follows is about the boundary: which TypeScript the compiler accepts,
and how values get from your application into a program that captures nothing.

## Programs and route bodies

A standalone program can declare an entry function:

```ts
function main(amounts: Uint256[], minimum: Uint256): Uint256 {
  let total = 0n;
  for (let i = 0; i < amounts.length; i = i + 1) {
    total = total + amounts[i];
  }
  require(total >= minimum);
  return total;
}
```

This is SauceScript source, not a host TypeScript module: `Uint256` and `require`
mean something to the Sauce compiler and nothing to `tsc`. A source error points at
a location and span; an error about an option, a resolver or an unavailable
target feature has nothing to point at. An editor learns SauceScript's names from the
`tsconfig.json` that `sauce init` writes beside a directory of programs
([In an editor](../guides/cli-programs.md#in-an-editor)).

A function declared `: void` can finish without returning a value. Other
functions must return on every path. Annotate helper functions returning arrays,
bytes, or records so their callers know the return shape. A file without a `main`
is a script: its top-level statements are the entry, which runs as `main(): void`,
so a script cannot `return`. The raw compiler and the route compiler both take one
as written.
Entry argument encoding does not determine return encoding. For ABI-decodable
EVM output, [return `abi.encode(...)`](../guides/compiling.md#return-values-an-abi-decoder-can-read).

The SDK provides a second authoring form: a route body passed to a chain helper.

```js
() => {
  USDC.approve(Uniswap.UniversalRouter, 1_000_000);
};
```

Pass this body to `Base(body, options)` or another chain helper as shown in the
[intent guide](../guides/intents.md). The SDK extracts its text, wraps it in
`main`, resolves SDK global names, and compiles it. For a body that falls through,
the compilation adapter adds a `void` entry annotation.

The callback must be synchronous, take no parameters, and retain source text the
SDK can parse. It captures **no host variables**. A host `const amount = ...`
does not make `amount` available to the compiler; pass it through
`options.compile.defines`, write it into generated source, or use a standalone
program with runtime entry arguments. If bundling/minification rewrites callback
names or bodies, use explicit source strings or source assets.

## Three ways values enter a program

| Channel                             | When resolved                          | Effect on the compiled program                                                      |
| ----------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| Literals and compile-time `defines` | During compilation                     | Values can be folded into bytecode; changing them can change the program hash       |
| `main` parameters                   | During execution                       | Values are encoded after the reusable program; their values are not compiler inputs |
| SVM `Account` parameters            | When instruction accounts are attached | Identities occupy manifest slots, separate from encoded scalar/collection arguments |

The choice between the first two is a design decision with consequences. The EVM
settle recipe takes its token list, floor and recipient as runtime parameters, so
one program — one hash — covers every value. The SVM settle recipe folds its floor
and token-program split in as defines instead, and is verified by recompiling with
the same values. Neither is a drop-in for the other.

## The language

The [SauceScript reference](../reference/saucescript.md) is the complete account of the language,
and every example and quoted error in it is checked against the compiler this package ships: types,
literals, operators, statements, functions and modules, every builtin on each target, and the
limits. What most often surprises a TypeScript author:

- Numbers are unsigned 256-bit integers, written plainly (`3000`, `10 ** 18`), and arithmetic is
  checked: overflow, underflow and division by zero revert. Write a negative amount as `-x`;
  `~x + 1` reverts when `x` is zero. A route callback written in TypeScript uses `bigint` literals
  (`3000n`), which TypeScript types; the compiler reads both spellings as the same integer.
- `bool` is kept apart from numbers, and `bytes`/`string` are byte strings: `"text"` is its UTF-8
  bytes and `` hex`a9059cbb` `` raw bytes. Every untagged template literal is rejected, with or
  without `${}`.
- Annotations are checked, and an unannotated parameter is a number, so a helper that takes or
  returns an array, a record or bytes says so. `Account` roles (`Account<Writable, Signer>`) exist
  on SVM only; on EVM an `Account` is an address and a role is a compile error.
- Destructuring binds the fields of something that produces a record — a multi-output contract
  call, `abi.decode`, `crypto.findPDA` — and not of an array.
- Functions are top-level declarations; `switch`, `try`/`catch`, classes, closures other than the
  EVM `.catch(() => { ... })` handler, spread and optional chaining are rejected.
- A module-level `const` is a compile-time value. A module-level `let` is re-initialised on every
  invocation — scratch space, not chain state. Reach for the target's storage builtins when
  something has to persist.

## EVM and SVM operations

The compiler shares a frontend across targets and rejects unavailable operations
for the target selected at compile time.

| Capability                                           | EVM                                      | SVM                                               |
| ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
| Arithmetic, functions, arrays, records, control flow | Supported                                | Supported                                         |
| ABI-bound `Contract.at(address).method(...)`         | Supported                                | Use CPI/account APIs                              |
| `evm.call`, `evm.static`, `evm.delegate`             | Supported                                | Unavailable                                       |
| `svm.call` with attached account slots               | Unavailable                              | Supported                                         |
| `abi.encode` / `abi.decode` builtins                 | Supported                                | Unavailable                                       |
| Persistent storage                                   | `evm.sload` / `evm.sstore`               | `svm.sload` / `svm.sstore` byte ranges            |
| Transient storage and external-call catch handlers   | EVM-specific                             | Unavailable                                       |
| SDK `USDC.approve(...)` and protocol-member rewrites | Supported for registered EVM deployments | Use SVM account-aware builders                    |
| Runtime entry arguments                              | ABI-v1 or compact-v1                     | ABI-v1 or compact-v1, plus separate Account slots |

Losing `abi.encode`/`abi.decode` on Solana does not cost you runtime entry
parameters — those are decoded by a separate mechanism and work on both targets.
Context reads differ where the chains differ: an EVM address and a Solana public
key are not the same width, and `ctx.blockNumber()` means a slot on Solana.

## Modules, ABI bindings, and global names

A direct compiler program can bind an EVM ABI explicitly:

```ts
import ERC20 from "./erc20.abi.json";

function main(token: Address, owner: Address): Uint256 {
  return ERC20.at(token).balanceOf(owner);
}
```

A bare JSON import binds a contract ABI. A JSON data import uses
`with { type: "json" }`. The host resolver must return the named file's bytes in
either case.

An ABI-bound call decodes what the ABI declares it returns. For an ERC-20 write
that is a `bool`, so `ERC20.at(token).approve(...)` reverts on a token that
returns nothing, such as USDT, and accepts one that returns `false`. Write token
transfers and approvals with `@sauce/token` instead, which follows OpenZeppelin
`SafeERC20`:

```ts
import { approve } from "@sauce/token";

function main(token: Address, spender: Address, amount: Uint256): void {
  approve(token, spender, amount);
}
```

`@sauce/token` also pulls tokens into a program, each pull a `safeTransferFrom`:
`transferFrom` on an allowance, and `permit` (EIP-2612) or `permitTransferFrom`
(Permit2) on the holder's signature. See
[Pulling tokens in](../guides/protocols-and-tokens.md#pulling-tokens-in).

A raw compile resolves `@sauce/token` by passing `resolveSdkPackage` and
`resolveSdkModule` from `@eco-incorp/sauce/compiler`. Swaps have a library of their
own, [`@sauce/router`](../api/router.md): one function per venue, taking its pool and
amount as run-time arguments, resolved the same way.

The compiler's `ambient` option broadcasts a SauceScript module's exports without
explicit imports. Its `defines` option injects scalar constants into every
module. Their precedence differs: ambient exports yield to declarations;
defines replace same-named module `const` values. Pick specific define names
because that replacement also reaches imported dependencies.

The SDK adds chain selection, token symbols, and protocol member access around
that compiler API. `openRoute` and chain helpers supply chain defines and the
default `@sauce/token` ambient module. Direct `compileSauceRoute()` accepts an
explicit `ambient` list and does not add that default list. Raw `compile()` adds
neither the SDK registry nor its filesystem resolver. See the
[compilation guide](../guides/compiling.md) for the exact boundary.
