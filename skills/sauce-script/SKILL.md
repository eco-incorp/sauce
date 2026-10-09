---
name: sauce-script
description: Writing SauceScript programs (.sauce.ts files) — the checked TypeScript subset Sauce compiles to on-chain bytecode, with a complete reference of its types, operators, statements and builtins (ctx, crypto, Math, abi, evm, svm, value methods, account properties, contract bindings, limits). Covers the two program forms (function main(...), whose parameters are every input a program takes, intent files included, and a file of top-level statements for a program with no inputs), what compiling a file for a chain adds (its names and token syntax, the source otherwise as written), module constants, helper functions, what syntax compiles and what to write instead, require/throw and atomic failure, catching a failed external call, and reading compile errors. Use when writing or editing any Sauce program, when a Sauce compile fails ("unsupported construct", "is not a declared variable", "expected a number, found a bool", "Unexpected token"), or when asked what SauceScript can or cannot express.
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
`Ethereum(...)`) are in `sauce-globals`.

## Two program forms

A program lives in a `.sauce.ts` file and is compiled **for a chain** (`--chain`), which decides
what every registry name means. A file takes one of two forms:

| Form                   | Inputs                                                   | Use it for                                                                                                                  |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **`function main(…)`** | `main`'s parameters, passed with `--args`                | every program that takes an input: one bytecode serves every value, such as a swap's tokens, amount and limit; intent files |
| **Top-level script**   | none: each value is written in the file or read on chain | a program with no inputs                                                                                                    |

A program with inputs declares `main`, and may declare helper functions and import ABIs.
(The `chain=…` after an example's opening fence here only says which chains it is checked on; it
is not part of the file.)

```sauce chain=base,arbitrum
// A fixed value of the program: a module constant, folded into the bytecode.
const FEE_BPS = 30;

// A helper. It returns a value on every path.
function afterFee(amount: Uint256, bps: Uint256): Uint256 {
  return amount - (amount * bps) / 10000;
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

**`main` may return a value**, which the cook returns to whoever called it, so an `eth_call` of
the cook reads it before anything is sent (`sauce simulate` prints it after `returns`). Declare
the type: `main(): Address`, `: Uint256` or `: bool` comes back as one 32-byte word, a record as its
fields one word each, an array as its elements one word each, with no length or offset in front,
and `: bytes` as the bytes themselves, unwrapped, so `return abi.encode(spent, bought)` gives two
words. A `void` `main` returns nothing.

That makes a rehearsal a way to read a chain: a program that only looks something up and returns
it, rehearsed with `sauce simulate`, prints the answer and sends nothing.

```sauce chain=base,arbitrum
// The Uniswap V3 WETH/USDC pool at the 0.05% tier (500 millionths), or 0 where there is none.
function main(): Address {
  return UniswapV3.Factory.getPool(WETH, USDC, 500);
}
```

A top-level script runs its statements in order, after its imports, and may declare helper
functions beside them. It takes no inputs: every value it uses is written in the file, read on
chain or a name the chain supplies. A value that changes from one run to the next is a parameter
of `main`.

```sauce chain=base,arbitrum
// A helper takes what it needs as parameters.
function afterFee(amount: Uint256): Uint256 {
  return amount - amount / 1000;
}

// Supplies the USDC this Pot holds, less 0.1%, to Aave V3 for the Pot's owner: in a cook on the
// owner's Pot, `ctx.msgSender()` is the owner who sent it, so the aTokens land in their wallet.
// `ctx.self()` there would keep them in the Pot.
const held = USDC.balanceOf(ctx.self());
require(held >= 1000000, "below 1 USDC");
const supplied = afterFee(held);
USDC.approve(AaveV3.Pool, supplied);
AaveV3.Pool.supply(USDC, supplied, ctx.msgSender(), 0);
```

A `const` at the top of a script is the script's own local: a helper cannot read it (pass it in).
Declare `main` to take inputs, to share a module constant with helpers, or to return a value.

## The file's header

Every program starts with a comment that says how to run it, in this order:

1. what the program does, in one line;
2. the `sauce` command that runs it, with `--chain <chain>` and `--args` naming every `main`
   parameter, in order: `--args <tokenIn> <tokenOut> <amountIn>`;
3. one line per parameter, `name: Type`, then what it means and its units, in smallest units
   (`5000000000` is 5,000 USDC, which has 6 decimals), and that an array or a record is passed as
   JSON;
4. one concrete run on a supported chain with real values: addresses taken from the registry
   (`sauce globals --chain <chain> --tokens`), the developer's own inputs left as `<placeholders>`.

An intent file is written the same way: its `main` parameters, then its `--intent-…` flags.
`sauce intent publish <file> --args …` takes the same arguments as `sauce run` and fixes them into
the intents it publishes (`sauce-intents`).

```sauce chain=base
// Pays each of `recipients` `amount` of the chain's USDC, from the Pot.
//
//   sauce run payout.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <recipients> <amount>
//
//   recipients: Address[]  who is paid, a JSON array: '["<recipient>","<recipient>"]'
//   amount: Uint256        what each is paid, in USDC's smallest units (6 decimals):
//                          5000000 is 5 USDC
//
// On Base, 5 USDC to each of two recipients:
//
//   sauce run payout.sauce.ts --chain base --keystore <keystore> \
//     --args '["<recipient>","<recipient>"]' 5000000
function main(recipients: Address[], amount: Uint256) {
  for (const to of recipients) {
    USDC.transfer(to, amount);
  }
}
```

## Inputs and fixed values

| Value                                                                    | Write it as                              | Arrives                                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------- |
| Anything the caller chooses per run: tokens, amounts, recipients, limits | a **`main(...)` parameter**              | with the transaction (`--args`); one program serves every value                  |
| The inputs of an intent, its refundee among them                         | **`main(...)` parameters**, the same way | with the cook that publishes it (`sauce intent publish --args`, `sauce-intents`) |
| A value the program fixes: a fee, a pool's tier                          | a **module constant** beside `main`      | folded into the bytecode                                                         |
| A value the chain supplies                                               | a global (`sauce-globals`)               | resolved when compiling for that chain                                           |

`main`'s parameters are taken in declaration order, ABI-encoded by default, and appended to the
program's bytecode: that is the payload a cook runs. `--args` and `--args-json` of `sauce run`,
`simulate` and `tx` encode them (`sauce-cli`); `sauce-typescript` covers encoding them from
TypeScript. A program compiles for every chain the SDK knows; for the initial release its cook is
built and sent only on Ethereum, Base and Solana, and on every other chain (a preview chain) it is
compiled and simulated (`sauce-chains`).

## Compiling for a chain

Compiling a file for a chain lowers the names the chain supplies (`sauce-globals`), the token
syntax and the intents the file opens; everything else reaches the compiler as written. A program
for a chain is the language of [references/builtins.md](references/builtins.md), with nothing
removed:

- Annotations go wherever the language takes them: `function half(x: Uint256): Uint256`, and a
  local's `let total: Uint256 = 0;`. A parameter with no annotation is a `Uint256`, and a local
  without one takes its type from its initializer.
- A record is an `interface` or an inline object type, `orders: Order[]` or
  `orders: { amount: Uint256, to: Address }[]` (`;` between the fields works too, as a formatter
  writes them); `main`'s arguments are encoded the same way for either.
- Trailing commas are fine, after `main`'s last parameter as anywhere else.

## Values

- Integers are 256-bit, written plainly (`3000`, `10 ** 18`), and checked: no floats (`1.5` is
  rejected), and a constant expression that overflows or underflows (`0 - 1`, `2 ** 256 - 1`) is
  a compile error. Write the maximum as `~0`, and a negative (two's-complement) amount as
  **`-x`**, which never fails; `~x + 1` reverts when `x` is `0`.
- Amounts are in the token's smallest units; nothing scales decimals for you.
- Addresses are numbers: a `main` parameter, a global such as `USDC`, or a literal taken from the
  registry, written as its hex (`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`); never an invented
  one.
- `bytes`: `` hex`a9059cbb` ``, `"text"`, `.concat`, `.slice(a, b)`, `.length`, `b[i]`,
  `x.toBytesBe(32)`, `x.toBytesLe(8)`, `abi.encode`/`abi.decode` (EVM). Bind a literal before
  calling a method on it: ``const selector = hex`a9059cbb`; selector.concat(data)``. `hex` is the
  only template form: every untagged template literal is rejected, with or without `${}`.
- Arrays and records: `[a, b]`, `new Array(n)`, `xs[i] = v`, `xs.length`, `{ amount: 1 }`.
  Destructuring, `const [a, b] = …`, needs an initializer that produces a record (a multi-output
  call, `abi.decode`); an array is indexed instead.
- `Account` parameters, with roles such as `Account<Writable>`, are `main`'s alone. On Solana they
  are the transaction's accounts; on an EVM chain only a bare `Account` compiles, and it is an
  address.
- A module-level `let` is scratch, reset on every run. Persistent state is `evm.sstore`/`evm.sload`
  (or `svm.sstore`/`svm.sload`).
- **At module level, only scalar literals.** A `let` there starts as a number, address or boolean
  literal; anything else (`[1, 2]`, `new Array(n)`, `-1`, `1 << 160`, a call) is refused with
  "must be initialized with a literal". A `const` array there is a lookup table, read only at a
  literal index (`FEES[0]`), never looped over. Declare arrays and computed values inside a function.

## Calling a contract

Call a contract by name, in this order of preference:

1. **A namespace**, for a contract the chain's registry records: `UniswapV3.Factory.getPool(...)`,
   `AaveV3.Pool.supply(...)`, typed by the registry's ABI, its address the chain's. An interface, a
   registry ABI with no address of its own, is called with the address it is at: a pool the
   factory returned is `UniswapV3.Pool(pool)`, as in `UniswapV3.Pool(pool).slot0()`, and any
   ERC-4626 vault `Erc4626.Vault(vault)`. A contract that has its own address takes `.at(address)`
   to call another deployment of the same ABI: `AaveV3.Pool.at(address)`. The chain's file in
   `sauce-chains`, or `sauce globals --chain <chain> --protocol <namespace>`, lists each
   namespace's contracts, interfaces and methods.
2. **A registry ABI import**, where the chain has no namespace for it: each protocol's registry
   page in `sauce-protocols` gives the import line, such as
   `import VaultABI from "./protocols/erc4626/VaultABI.json"`, and the binding takes the address
   with `.at`: `VaultABI.at(vault).convertToAssets(shares)`.
3. **The program's own ABI**, for a contract no registry knows, or a function its registry ABI
   does not declare: a JSON ABI file beside the program, holding only the functions the program
   calls, with the deployed contract's types from its verified source, imported by relative path
   as the file's default export: `import IOracle from "./IOracle.json"`, then
   `IOracle.at(pool).observe(...)`. The `sauce` command reads it from beside the file; through the
   MCP server, pass it in `modules` with the program (`{ "IOracle.json": "<its JSON>" }`).
   [examples/twap.sauce.ts](examples/twap.sauce.ts) finds a pool through `UniswapV3.Factory` and
   reads its price history through [examples/IOracle.json](examples/IOracle.json), which declares
   the one function the registry's pool ABI lacks, `observe`.

Never call through `evm.static` (or `evm.call`) with a hex selector where one of these is
possible: the typed call encodes the arguments, decodes the result and names its fields. Take only
what you need from a result: `const [sqrtPriceX96] = UniswapV3.Pool(pool).slot0();` and
`UniswapV3.Pool(pool).slot0().sqrtPriceX96` both read the first field alone.

```sauce chain=base,ethereum
function main(vault: Address, shares: Uint256): Uint256 {
  // A contract the chain's registry records: its factory, by name.
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  require(pool != 0, "no WETH/USDC 0.05% pool");
  // Interfaces, called with the address they are at: the pool it returned, and a vault.
  const [sqrtPriceX96] = UniswapV3.Pool(pool).slot0();
  require(sqrtPriceX96 > 0, "the pool is not initialized");
  return Erc4626.Vault(vault).convertToAssets(shares);
}
```

**Who receives what a call produces.** Many calls name a beneficiary: a lending market's
`onBehalfOf` (who gets the aTokens), a vault's `receiver`, a swap's `recipient`, a bridge's `to`.
Every call comes from the Pot, so `ctx.self()` there, or a call that credits its caller, leaves the
output in the Pot: it is the owner's, but not in their wallet, and only another cook moves it.
Ask the user whether it should end in their wallet or stay in the Pot, and write it that way, the
wallet a `main` parameter. In a cook on the user's own Pot, `ctx.msgSender()` is its owner, the
wallet that sent the cook; in an intent's body it is not (the body runs on a Pot the intent's
solvers share), so there the wallet is always a parameter:

```sauce chain=base,ethereum
// Supplies `amount` of the Pot's USDC to Aave V3 for `onBehalfOf`, who receives the aTokens: the
// user's wallet, or the Pot itself (`ctx.self()`) when the user keeps the position there.
function main(onBehalfOf: Address, amount: Uint256) {
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, onBehalfOf, 0);
}
```

## Functions

- **Call what exists directly.** Typed bindings, namespaces and library functions are called as
  they are: `USDC.transfer(...)`, `UniswapV3.Factory.getPool(...)`, `uniswapV3(...)` from
  `@sauce/router`. Do not wrap a single call in a helper, and do not hand-roll a raw selector with
  `evm.static` and `abi.decode` where a typed binding or a namespace exists. Keep a helper only for
  real logic used more than once.
- Helpers are top-level `function` declarations, annotated on the signature. They may call each
  other and recurse; `main` is never called.
- **A helper that returns a value returns it on every path**: an `if` with a `return` and no
  `else`, or a loop that may end without one, fails the compile with "does not return on every
  path". End the helper with a `return`.

```sauce fails chain=base
function larger(a: Uint256, b: Uint256): Uint256 {
  if (a > b) {
    return a;
  }
}

function main(a: Uint256, b: Uint256): Uint256 {
  return larger(a, b);
}
```

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
  if (best[0] == 0 || isBetter(price, best[0], sellsToken0)) {
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

| Rejected                                                                                                           | Write instead                                                               |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `switch`, `for...in`, `enum`, `type` aliases, `await`                                                              | `if` chains, arrays, inline object types, plain functions                   |
| `finally`                                                                                                          | code after the `try`; to survive a failure on EVM, `try`/`catch` (below)    |
| arrow functions and nested functions, except an intent's body, `.then(() => { ... })`, and `.catch(() => { ... })` | top-level function declarations                                             |
| template literals, comparing bytes with `==`                                                                       | `"text"`, or bytes built with `.concat`; compare `crypto.keccak256` of each |
| `as` casts, default parameters, spread, object destructuring                                                       | explicit values and field access                                            |
| `arr.push(x)`, `console.log`, `Math.min`/`max`/`abs`/`pow`                                                         | `new Array(n)` and an index; `if`; `**`                                     |

```sauce fails
function main(x: Uint256): Uint256 {
  switch (x) {
    case 1:
      return 1;
  }
  return 0;
}
```

## Failure is atomic

`require(false)`, `require(cond, "reason")`, `throw "reason"`, a reverting call, and every guard
the package emits revert the **whole transaction**: for an intent, the whole fulfilment, including
the calls that ran before the program. Nothing half-happens, so put every safety check in the
program.

A failure is survived on EVM, two ways. `try { ... } catch (e) { ... }` runs its block in a frame of
its own: when anything in it reverts, everything it did is undone together and the `catch` block
runs, with `e` what it reverted with (`bytes`, its first 256 bytes). The block reads the code around
it but cannot assign it; the `catch` block can.

```sauce chain=base
// Sends `amount` USDC only if at least 1 USDC stays in the Pot; otherwise nothing moves, and it
// returns the length of the reason it refused with.
function main(to: Address, amount: Uint256): Uint256 {
  let refused = 0;
  try {
    USDC.transfer(to, amount);
    require(USDC.balanceOf(ctx.self()) >= 1000000, "would leave less than 1 USDC");
  } catch (e) {
    refused = e.length;
  }
  return refused;
}
```

On one external call, `.catch(() => { ... })` runs instead when that call reverts, and the call's
own effects are undone (`.catch((e) => { ... })` names its revert data). The handler may assign
locals of the enclosing function.

```sauce chain=base
import { ISauceRouter } from "./artifacts/ISauceRouter.json";

function main(pool: Address, amount: Uint256, sqrtPriceLimitX96: Uint256, recipient: Address) {
  let filled = true;
  ISauceRouter.at(ctx.self())
    .swapV3(pool, WETH, WETH < USDC, amount, sqrtPriceLimitX96, recipient)
    .catch(() => {
      filled = false;
    });
  require(filled, "the pool refused");
}
```

The value form, `const v = <call>.catch(() => { return <constant>; });`, gives the constant when
the call fails. It takes a call that returns one value: a bound method with one output, such as
a namespace contract's or an imported ABI's. A raw `evm.call`, `evm.static` or `evm.delegate`
returns bytes, which no constant can stand in for ("a `.catch()` fallback: expected a bytes value,
found a number"). For a raw read that may fail, test it with the statement form, then read again
only when it worked. A read changes nothing, so the second call is safe; never repeat a write
that way.

`.catch()` catches a call that reverts, not a call to an address with no code. That call succeeds
and returns nothing, and decoding nothing reverts the cook, `.catch()` or not. When an address may
have no code, check `ctx.codeSize(address) > 0` first:

```sauce chain=base,arbitrum
// One word from a read that may fail, or 0: an address with no code, or a read that reverts.
function readWord(target: Address, query: bytes): Uint256 {
  if (ctx.codeSize(target) == 0) {
    return 0;
  }
  let readable = true;
  evm.static(target, query).catch(() => {
    readable = false;
  });
  if (!readable) {
    return 0;
  }
  return abi.decode(evm.static(target, query), ["Uint256"])[0];
}

function main(target: Address, query: bytes): Uint256 {
  return readWord(target, query);
}
```

## What a program costs

On an EVM chain, a cook's gas is the transaction's own, the Kitchen's and the Pot's, plus the
program's, which the engine interprets step by step. Measured on a local chain through the engine
and a Kitchen-made Pot:

| What                                                | Gas, about                                   |
| --------------------------------------------------- | -------------------------------------------- |
| A cook whose program does almost nothing            | 43,000, the transaction's 21,000 included    |
| One loop iteration that adds two numbers            | 1,000                                        |
| Writing an array element, or reading one            | 500, or 300, on top                          |
| A call to a contract the transaction already called | 2,000 on top, plus what that contract spends |
| `.catch()` on that call                             | 100 more                                     |
| `crypto.keccak256(abi.encode(a, b))`                | 2,000                                        |

The first call to a contract in a transaction costs 2,600 more than later ones, as on any EVM
chain. A loop is what adds up in the program itself: a hundred iterations of a little arithmetic
cost about 100,000 gas. Read a value once and keep it in a local rather than calling for it twice,
and bound each loop by its input. The real figure is the rehearsal's:
`sauce simulate` prints it, and `sauce run` and most signers set the gas limit from an estimate.
Leave headroom when the chain can move between the rehearsal and the send; a swap that crosses more
ticks spends more.

## In an editor

An editor checks a `.sauce.ts` file as TypeScript, which knows none of SauceScript's names: with
no project for them, it marks `Token`, `USDC`, `ctx` and every other global as unknown.
`sauce init <dir> --tsconfig` writes `<dir>/tsconfig.json`, which types every `.sauce.ts` under
`<dir>` as SauceScript: its types and builtins, each chain's tokens and namespaces, and the ABIs a
program imports. Keep programs in such a directory (`sauce init` makes `programs/` one); the
installed skills' examples are typed by the same file beside them. The types come from the package,
so the project must have it installed, and an editor running the project's own TypeScript also
drops what TypeScript reports on valid SauceScript (a `bigint` index, a plain integer beside a
`Uint256`). The compile, not the editor, decides whether a program is valid.

## Reading a compile error

Compile errors fail the command; there is no warning channel. `sauce compile` points at the file's
line and column, including on a line the package rewrote, and a `hint:` line names what to add.
`X is not a declared variable` usually means a typo, a name the chain does not have
(`sauce-globals`), or a value the program should take as a `main` parameter.
`Unexpected token` is a syntax error at the line and column it names.
`a function argument: expected a number, found a bool` at a call usually means the called
function's parameter has no annotation, so it is a number: annotate it, `first: bool`. For any
other message, find it in [references/builtins.md](references/builtins.md). `a nested function
declaration is not supported` means a function declared inside another function or a block:
declare it at the top level. `X is called but never declared` means a function that is not in
scope, usually a typo.

## Example

[examples/saucescript.mts](examples/saucescript.mts) compiles a guarded program, asserts each
rejection above, and pins what compiling for a chain adds. Complete programs are listed in
`sauce-examples`.
