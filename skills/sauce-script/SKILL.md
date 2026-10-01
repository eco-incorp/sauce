---
name: sauce-script
description: Writing SauceScript programs (.sauce.ts files) — the checked TypeScript subset Sauce compiles to on-chain bytecode, with a complete reference of its types, operators, statements and builtins (ctx, crypto, Math, abi, evm, svm, value methods, account properties, contract bindings, limits). Covers the two program forms (function main(...) with runtime arguments, and a file of top-level statements whose values are defines, the form for intent files), what compiling a file for a chain adds (annotations on signatures only), module constants as overridable defaults, helper functions, what syntax compiles and what to write instead, require/throw and atomic failure, catching a failed external call, and reading compile errors. Use when writing or editing any Sauce program, when a Sauce compile fails ("unsupported construct", "is not a declared variable", "expected a number, found a bool", "Unexpected token"), or when asked what SauceScript can or cannot express.
---

# Writing SauceScript

A Sauce program is SauceScript: it looks like TypeScript, compiles to bytecode, and a Sauce engine
runs it atomically inside one transaction. This skill is the language.

**Look a builtin up in [references/builtins.md](references/builtins.md) before using it.** It lists
every type, literal, operator and statement, every `ctx`, `crypto`, `Math`, `abi`, `evm` and `svm`
builtin, the methods on values, account properties, contract bindings and limits, each with its
targets, an example and the exact error a misuse gives. Every example in it compiles and every
rejection it lists is refused. [references/builtins.json](references/builtins.json) is the same list
for a program to read. The names a chain supplies (`USDC`, `Token(...)`, `UniswapV3.Factory`,
`Arbitrum(...)`) are in `sauce-globals`.

## Two program forms

A program lives in a `.sauce.ts` file and is compiled **for a chain** (`--chain`), which decides
what every registry name means. A file takes one of two forms:

| Form                   | Values                                                                                               | Use it for                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **`function main(…)`** | `main`'s parameters, passed at run time (`--args`); module constants for choices made per compile    | reusable programs: one bytecode serves every input, such as a swap's tokens, amount and limit |
| **Top-level script**   | names the file leaves undeclared, each set by a define (`--define NAME=VALUE`); no runtime arguments | intent files (`sauce-intents`), which are only statements, and one-off programs               |

A program with runtime inputs declares `main`, and may declare helper functions and import ABIs:

```sauce chain=base,arbitrum
// A compile-time choice: a module constant, which a define of the same name replaces.
const FEE_BPS = 30n;

// A helper. It returns a value on every path.
function afterFee(amount: Uint256, bps: Uint256): Uint256 {
  return amount - (amount * bps) / 10000n;
}

// Runtime inputs: main's parameters, passed with the transaction.
function main(recipient: Address, floor: Uint256) {
  const held = USDC.balanceOf(ctx.self());
  if (held < floor) {
    throw "below floor";
  }
  USDC.transfer(recipient, afterFee(held, FEE_BPS));
}
```

A top-level script runs its statements in order. It declares no function and imports nothing, and
every value it does not compute is a define: the name stays undeclared in the file, and
`--define RECIPIENT=<address> --define FLOOR=1000000` sets it.

```sauce chain=base,arbitrum define=RECIPIENT,FLOOR
require(RECIPIENT != 0n, "set RECIPIENT");
const held = USDC.balanceOf(ctx.self());
require(held >= FLOOR, "below floor");
USDC.transfer(RECIPIENT, held);
```

A `const` at the top of a script is the script's own local: a define of the same name does not
reach it, and the `sauce` command refuses such a define rather than ignore it.

## Runtime inputs and compile-time values

| Value                                                                    | Write it as                                                                  | Arrives                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Anything the caller chooses per run: tokens, amounts, recipients, limits | a **`main(...)` parameter**                                                  | with the transaction (`--args`); one program serves every value    |
| A choice made per compile: which venues exist on the chain, a fixed fee  | a **module constant** beside `main`, which a **define** of its name replaces | folded into the bytecode; a different value is a different program |
| A value of a script, or of an intent file                                | an **undeclared name**, set by a define                                      | folded into the bytecode                                           |
| A value the chain supplies                                               | a global (`sauce-globals`)                                                   | resolved when compiling for that chain                             |

`main`'s parameters are taken in declaration order and encoded after the program: `--args` and
`--args-json` of `sauce run`, `simulate` and `tx` (`sauce-run`), or `routes.encodeEntryArguments`
from TypeScript (`sauce-typescript`).

## Compiling for a chain

The package reads a file compiled for a chain as JavaScript before the compiler sees it, which adds
rules of its own on top of the language:

- **Annotations go on function signatures only.** `function main(token: Address, amounts: Uint256[])`
  and `function half(x: Uint256): Uint256` compile; a parameter with no annotation is a `Uint256`.
  A local takes its type from its initializer: `let total = 0n;`, never `let total: Uint256 = 0n;`.
- **Records are inline object types** in a signature, `orders: { amount: Uint256, to: Address }[]`;
  there is no `interface` declaration.
- **No trailing comma** after `main`'s last parameter.
- **A script declares no function and imports nothing**; a program with helper functions or an
  imported ABI declares `main`.

The reference's typed examples (`interface`, annotated locals) are the language as the compiler
takes it directly; a program for a chain writes them as above.

## Values

- Integers are 256-bit and checked: no floats (`1.5` is rejected), and a constant expression that
  overflows or underflows (`0n - 1n`, `2n ** 256n - 1n`) is a compile error. Write the maximum as
  `~0n`, and a negative (two's-complement) amount as **`-x`**, which never fails; `~x + 1n` reverts
  when `x` is `0`.
- Amounts are in the token's smallest units; nothing scales decimals for you.
- Addresses are numbers: a `main` parameter, a global such as `USDC`, or a literal taken from the
  registry, written with an `n` (`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n`); never an invented
  one.
- `bytes`: `` hex`a9059cbb` ``, `"text"`, `.concat`, `.slice(a, b)`, `.length`, `b[i]`,
  `x.toBytesBe(32n)`, `x.toBytesLe(8n)`, `abi.encode`/`abi.decode` (EVM). Bind a literal before
  calling a method on it: ``const selector = hex`a9059cbb`; selector.concat(data)``. `hex` is the
  only template form: every untagged template literal is rejected, with or without `${}`.
- Arrays and records: `[a, b]`, `new Array(n)`, `xs[i] = v`, `xs.length`, `{ amount: 1n }`.
  Destructuring, `const [a, b] = …`, needs an initializer that produces a record (a multi-output
  call, `abi.decode`); an array is indexed instead.
- `Account` parameters, with roles such as `Account<Writable>`, are `main`'s alone. On Solana they
  are the transaction's accounts; on an EVM chain only a bare `Account` compiles, and it is an
  address.
- A module-level `let` is scratch, reset on every run. Persistent state is `evm.sstore`/`evm.sload`
  (or `svm.sstore`/`svm.sload`).
- **At module level, only scalar literals.** A `let` there starts as a number, address or boolean
  literal; anything else (`[1n, 2n]`, `new Array(n)`, `-1n`, `1n << 160n`, a call) is refused with
  "must be initialized with a literal". A `const` array there is a lookup table, read only at a
  literal index (`FEES[0]`), never looped over. Declare arrays and computed values inside a function.

## Functions

- Helpers are top-level `function` declarations, annotated on the signature. They may call each
  other and recurse; `main` is never called.
- **Arrays and records are passed by reference**: a helper that writes `xs[i] = v` changes the
  caller's array, so a helper can fill an array it is given. Numbers, bools and bytes are copies.
- **A comparison is a `bool`, but a function with no return annotation returns a number**, even
  `return a > b` (1 or 0). `if`, `while` and `&&` take either; a `: bool` function cannot return the
  number. Give a helper that answers yes or no a `: bool` return type:

```sauce chain=base,arbitrum
// Selling token0 (the lower address) pushes a pool's price down, so a higher price is better.
function isBetter(price: Uint256, than: Uint256, sellsToken0: bool): bool {
  if (sellsToken0) {
    return price > than;
  }
  return price < than;
}

// Fills `best` in place: an array goes to a helper by reference.
function keepBest(best: Uint256[], price: Uint256, sellsToken0: bool): void {
  if (best[0] == 0n || isBetter(price, best[0], sellsToken0)) {
    best[0] = price;
  }
}

function main(prices: Uint256[], tokenIn: Address, tokenOut: Address): Uint256 {
  let best = new Array(1);
  for (const price of prices) {
    keepBest(best, price, tokenIn < tokenOut);
  }
  return best[0];
}
```

## Syntax that compiles, and what to write instead

Compiles: `let`/`const`, `if`/`else if`/`else`, `while`, C-style `for`, `for...of` over an array,
`break`/`continue`, `i++` and `+=` as statements, ternaries, `&&`/`||`/`!`, `**`, bit operators,
`/` and `%`, helper functions, `Math.mulDiv(a, b, c)`, `Math.sqrt(x)`.
The full list, with what each rejection says, is section 14 of
[references/builtins.md](references/builtins.md).

| Rejected                                                                                                          | Write instead                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `switch`, `for...in`, `class`, `enum`, `type` aliases, `await`                                                    | `if` chains, arrays, inline object types, plain functions                                    |
| `try`/`catch`, `throw new Error(...)`                                                                             | `require(cond, "reason")` or `throw "reason"`; for a failing external call, `.catch` (below) |
| arrow functions and nested functions, except the intent syntax `Chain(() => { ... })` and `.catch(() => { ... })` | top-level function declarations                                                              |
| template literals, comparing bytes with `==`                                                                      | `"text"`, or bytes built with `.concat`; compare `crypto.keccak256` of each                  |
| `as` casts, default parameters, spread, object destructuring                                                      | explicit values and field access                                                             |
| `arr.push(x)`, `console.log`, `Math.min`/`max`/`abs`/`pow`                                                        | `new Array(n)` and an index; `if`; `**`                                                      |

```sauce fails
function main(x: Uint256): Uint256 {
  switch (x) {
    case 1n:
      return 1n;
  }
  return 0n;
}
```

## Failure is atomic

`require(false)`, `require(cond, "reason")`, `throw "reason"`, a reverting call, and every guard
the package emits revert the **whole transaction**: for an intent, the whole fulfilment, including
the calls that ran before the program. Nothing half-happens, so put every safety check in the
program.

The one way to survive a failure is on an external EVM call: `.catch(() => { ... })` runs instead
when that call reverts, and the call's own effects are undone. The handler may assign locals of the
enclosing function.

```sauce chain=base
import { ISauceRouter } from "./artifacts/ISauceRouter.json";

function main(pool: Address, amount: Uint256, sqrtPriceLimitX96: Uint256) {
  let filled = true;
  ISauceRouter.at(ctx.self())
    .swapV3(pool, WETH, USDC, amount, sqrtPriceLimitX96, ctx.self(), ctx.self())
    .catch(() => {
      filled = false;
    });
  require(filled, "the pool refused");
}
```

## Reading a compile error

Compile errors fail the command; there is no warning channel. `sauce compile` points at the file's
line and column, including on a line the package rewrote, and a `hint:` line names the flag or
define to add. `X is not a declared variable` usually means a missing define or `main` parameter.
`Unexpected token` usually means an annotation outside a signature, an `interface`, or a trailing
comma after `main`'s last parameter. For any other message, find it in
[references/builtins.md](references/builtins.md). `a nested function declaration is not supported`
means a helper declared in a script: declare `main` beside it. `X is called but never declared`
means a function that is not in scope, usually a typo.

## Example

[examples/saucescript.mts](examples/saucescript.mts) compiles a guarded program, asserts each
rejection above, and pins what compiling for a chain adds. Complete programs are listed in
`sauce-examples`.
