# Architecture

**Concept** · [Documentation](../README.md) · [Quick start](../guides/quick-start.md) · [SauceScript](saucescript.md)

> You write a program in words you can read. The compiler translates it into compact code, like a
> recipe rewritten as a card of short instructions. On the chain, the engine reads that card and
> carries it out, inside your Pot. This package is your toolbox around them: it knows where every
> token and protocol lives on every chain, and it packs the card into a transaction. This page says
> which piece does which job.

This page is for you once you have run a program ([quick start](../guides/quick-start.md)) and know
what a Pot and a cook are ([Kitchen, Pot and cook](kitchen-pot-cook.md)). Knowing which piece owns a
problem tells you where to look when something fails.

## Three pieces

Sauce turns a program into one atomic execution on chain: every step happens, or none does. Three
pieces divide that work:

| Piece    | Where it lives                                   | What it does                                                                            |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| This SDK | `@eco-incorp/sauce` and its subpaths             | Knows every chain, protocol and token; builds programs and cooks; checks and plans them |
| Compiler | bundled, exposed at `@eco-incorp/sauce/compiler` | Checks SauceScript, resolves modules and ABIs, emits bytecode for one chain's kind      |
| Engine   | deployed on chain, with a Kitchen and Pots       | Executes that bytecode against the chain's real contracts and accounts                  |

You install one package. The compiler comes with it, and the engine is already on chain. A program
passes through all three:

```text
pay.sauce.ts ─► the SDK       names become addresses on the chain, ABIs are supplied
             ─► the compiler  every line checked, bytecode out
             ─► the SDK       the cook built: to your Pot, the program, the Kitchen's fee
             ─► your wallet   signs and sends it
             ─► the engine    runs the program inside your Pot, every step or none
```

What the engine does is simple enough to state in a sentence, and it is all you need to reason
about: **it runs your program's steps in order, inside the surrounding transaction, and anything
that reverts reverts the whole thing.** There is no partial execution, no retry, and no undoing of
one step alone. The bytecode is Sauce's own, not a Solidity contract's code and not a Solana
program, and only a Sauce engine runs it.

## From a name to a contract call

The quick start's program pays with one line:

```js
USDC.transfer(to, amount);
```

The chain you compile for decides which `USDC` that is. Before compiling, the SDK rewrites the
names a program uses: it gives `USDC` the token's address on that chain, and turns the token write
into a call to `transfer` in `@sauce/token`, Sauce's token library, which checks the token's reply
as OpenZeppelin's SafeERC20 does. A protocol call such as `UniswapV3.Factory.getPool(...)` becomes a
call bound to that contract's ABI, its interface, at its address on that chain. A balance such as
`self.USDC` becomes a call to the token's `balanceOf` for the Pot.

These names are the SDK's, not the compiler's. The compiler used on its own, from TypeScript,
resolves nothing for you: you bind ABIs and supply addresses yourself
([Compiling programs](../guides/compiling.md)). [Names and registries](names-and-registries.md)
explains where the names come from.

## Two environments that look alike

A program is **source text**, even when you write it as a TypeScript function in your own code.
The SDK reads its text, rewrites it and compiles it; it never runs it as JavaScript, and it captures
no variable around it. A `const amount = …` in your application does not exist inside the program:
give the program the value instead ([SauceScript](saucescript.md) explains how values reach a
program).

That is why `Base` and `USDC` behave differently even though both are bare names in your editor.
`Base` is a value you import from the package and read in your application, for that chain's
addresses, such as `Base.USDC.address`. `USDC` is a name inside the program, which the compiler
resolves for the chain. The package ships TypeScript declarations for the program's names so your
editor checks them, but a declaration is a type, not a value you can use in your application.

## On the chain

[Kitchen, Pot and cook](kitchen-pot-cook.md) introduces the contracts a program runs through. A few
more facts explain how the pieces stay paired.

A cook names the engine each time, and the engine accepts only Pots its own Kitchen created, with
the Pot code it was built for. A Kitchen release that changes the Pot's code starts a new family of
Pot addresses, and a Pot of an earlier family keeps running on the engine built for it. On Ethereum
and Base, the engine refuses to run anywhere but inside such a Pot.

### A Pot's Router

A Pot's swaps run on **its own Router**. When a pool calls back in the middle of a swap, to be paid,
the call reaches the Pot, and the Pot hands it to its Router, which pays the pool on the Pot's
behalf. A new Pot starts on the Kitchen's current Router. After that, only the Pot's owner can point
it at another one; the Kitchen's owner moves the Router that new Pots start on, and nothing else,
and a Router change moves no Pot address. A Pot can also be created with its Router fixed for good.
[A Pot's Router after a rollout](../api/README.md#a-pots-router-after-a-rollout) shows how to check
a Pot and update it.

### On Solana

Compiling for Solana also returns an **account manifest**: every account the program needs, in
order, with the role each must have. The SDK works out most of those accounts from your wallet, your
Pot and the arguments, builds the transactions, and uploads a program too large for one transaction
before running it. [How Sauce runs on Solana](solana-model.md) explains each part.

## Versions travel with artifacts

A compiled program is paired with the engine that runs it by exact version, in both directions:
each compiler release names the engine releases its output runs on, and those engines run no other
compiler's output. The compiler reports what it produced; it does not look at a chain to find what
is deployed there. The SDK pins one compiler, ships the engines it pairs with, and refuses to build
a cook for an engine another compiler pairs with
([which engine runs a program](../api/compiler.md#which-engine-runs-a-program)).
[Deployments](../reference/deployments.md) lists the released addresses.

Changing the compiler can change bytecode without changing a line of source. Anything that pins
bytes, such as a settlement's hash, a cached program or a staged program on Solana, has to be
derived again when the compiler moves ([Upgrading](../guides/upgrading.md)).

## Next

- Why programs are written in a small, strict TypeScript, and how values reach them:
  [SauceScript](saucescript.md).
- How a name such as `USDC` becomes an address on each chain:
  [Names and registries](names-and-registries.md).
