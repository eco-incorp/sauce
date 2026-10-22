# SauceScript

**Concept** · [Documentation](../README.md) · [Write your first program](../guides/write-your-first-program.md) · [SauceScript reference](../reference/saucescript.md)

> SauceScript is the language you write programs in. It looks like TypeScript, but it is smaller and
> stricter, like a recipe card with a fixed set of words: the compiler checks every line before
> anything runs. Once your program is running on the chain, it cannot ask your app for anything, so
> whatever it needs, you hand it at the start.

This page is for you once you have written a program of your own
([Write your first program](../guides/write-your-first-program.md)). It explains why the language
is shaped the way it is, and how values reach a program. Every type, statement and builtin, with
the errors the compiler gives, is in the [SauceScript reference](../reference/saucescript.md).

## Why a subset of TypeScript

A program reads like TypeScript, because most people who write one already know TypeScript, and
because an editor can then check it as you type (`sauce init` sets that up). It has the familiar
things: variables, functions, conditions, loops, arrays and records.

```js
function main(amounts: Uint256[], minimum: Uint256): Uint256 {
  let total = 0;
  for (const amount of amounts) {
    total = total + amount;
  }
  require(total >= minimum, "below the minimum");
  return total;
}
```

But a program never runs in a JavaScript engine. The Sauce engine runs it on chain, inside one
transaction, on Ethereum, Base, Arc or Solana alike. So the language keeps only what has one fixed
meaning there and can be checked in full before anything runs. What cannot is left out: classes,
closures, `try`/`catch`, `switch`, `null` and `undefined`, fractions, and JavaScript's libraries.
[What is not supported](../reference/saucescript.md#14-not-supported-and-what-to-write-instead)
lists each, with what to write instead.

The checks are strict for the same reason: a mistake costs money. Annotations are checked, and a
parameter without one is a number. A name the chain does not have, a wrong argument count or a value
of the wrong type fails the compile, with the line and column, before anything is sent.

## Numbers are whole, and checked

Every number is an unsigned 256-bit integer, the chain's own word. There are no fractions, so an
amount is written in the token's smallest unit: USDC has 6 decimals, so 1 USDC is `1000000`, and
1 ETH is `10 ** 18`. Write integers plainly: `3000`, never `3000n`.

Arithmetic is checked as the program runs. An overflow, an underflow or a division by zero reverts
the whole transaction, so a sum never silently wraps around. A negative amount, which some
protocols take, is written `-x`, and the `Math` builtins compare and divide signed values.

`bool` is kept apart from numbers, and `bytes` and `string` are both byte strings: `"text"` is its
UTF-8 bytes, and `` hex`a9059cbb` `` raw bytes.

## Failure is a revert

A program has no exceptions to catch. `require(condition, "message")` stops the whole transaction
when its condition is false, and so do `throw`, a failed call and any checked operation: nothing
that ran before survives. That is what makes a program safe to write without cleanup code. The one
failure a program can survive is a failed call to another contract on an EVM chain, with
`.catch(() => { ... })`, the only arrow function the compiler takes.

## How values reach a program

A program runs on chain, so it captures nothing from the application that sent it, and it cannot
ask for anything while it runs. A value reaches it in one of three ways:

| Channel                                    | When it is resolved               | Effect on the compiled program                                          |
| ------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------- |
| Literals, and the names the chain gives it | When the program compiles         | Folded into the bytecode: changing one changes the program and its hash |
| `main`'s parameters                        | When the program runs             | Encoded after the program, so one compiled program serves every value   |
| `Account` parameters, on Solana            | When the transaction is assembled | The accounts the transaction attaches, in the order `main` declares     |

Anything that varies from one run to the next is a `main` parameter. The quick start's
`pay.sauce.ts` takes `to` and `amount` that way, and you give them each time you run it. A value fixed for every run,
such as a fee in basis points, is a `const` in the program. `USDC`, `UniswapV3.Factory` and the
chain's id are the chain's names, filled in when the program compiles for that chain.

The choice between compiling a value in and passing it at run time has consequences. Sauce's EVM
settlement program takes its tokens, floor and recipient as run-time parameters, so one program,
with one hash, covers every value, and a checker compares that hash. Its Solana counterpart compiles
its floor into the program instead, and is checked by compiling again with the same values.

## One language, two kinds of chain

The compiler checks a program for one of two targets: **EVM** for Ethereum, Base and chains like
them, and **SVM** for Solana. Most of the language works on both. Where the chains differ, a
builtin exists on one target only, and using it on the other is a compile error, never a silent
difference:

| Capability                                           | EVM                       | SVM                                         |
| ---------------------------------------------------- | ------------------------- | ------------------------------------------- |
| Arithmetic, functions, arrays, records, control flow | Yes                       | Yes                                         |
| Token names, balances and `USDC.transfer(...)`       | Yes                       | Yes, with the accounts worked out for you   |
| Calling a contract through its ABI                   | Yes                       | No: call a program with `svm.call`          |
| `abi.encode`, `abi.decode`                           | Yes                       | No                                          |
| Storage that lasts between runs                      | `evm.sload`, `evm.sstore` | `svm.sload`, `svm.sstore`, in account bytes |
| Surviving a failed call with `.catch()`              | Yes                       | No                                          |
| `main`'s parameters                                  | Yes                       | Yes, plus `Account` parameters              |

Context reads differ where the chains do: a Solana key is wider than an EVM address, and
`ctx.blockNumber()` is a slot on Solana. [How Sauce runs on Solana](solana-model.md) explains
accounts.

## Libraries and contracts

A program calls other code in three ways:

- **Sauce's libraries.** `@sauce/token` moves and reads tokens, with no import needed:
  `USDC.transfer(to, amount)` is a call to it, and its writes follow OpenZeppelin's SafeERC20, so a
  token that returns nothing, such as USDT, works. `@sauce/router` has one swap function per kind
  of pool ([`@sauce/router`](../api/router.md)).
- **Protocols by name.** `UniswapV3.Factory`, `AaveV3.Pool`: the chain's deployment, with its
  functions ready to call ([Names and registries](names-and-registries.md)).
- **Any contract by its ABI.** `import ERC20 from "./erc20.abi.json"`, then
  `ERC20.at(address).balanceOf(owner)`. Such a call decodes exactly what the ABI declares, so for
  token writes, prefer `@sauce/token`.

A file without `main` is a **script**: its top-level statements run as the program, and it takes no
inputs. Declare `main` to take inputs or return a value.

## Next

- Use protocols by name in a program: [Swap by name](../guides/swap-by-name.md), the next tutorial.
- Every type, statement, builtin and limit: the [SauceScript reference](../reference/saucescript.md).
