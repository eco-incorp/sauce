# What Sauce is

**Concept** · [Documentation](../README.md) · [Quick start](../guides/quick-start.md) · [Glossary](glossary.md)

> Sauce lets you write a short program in SauceScript, a subset of TypeScript, that reads live
> onchain state, chooses a path and composes contract calls in one transaction. Think of a recipe
> handed to a cook: the cook follows every step, and if one step fails, the dish is thrown out as
> if it was never started. This page says what Sauce is, what it is not, and how your program
> becomes one transaction.

Your program enforces the conditions you write, at execution time, and an unhandled failure
reverts every step of the transaction. Approvals your wallet or Pot gave in earlier transactions
are outside that rollback: they stay as they were. You run new logic through your Pot without
deploying a contract for each program, and one language serves EVM chains and Solana, though
protocol calls and account setup differ between them.

Read this page first. It needs only the basic ideas of a blockchain: a wallet, a transaction, a
token. It explains and asks you to run nothing; the [quick start](../guides/quick-start.md) does
that next.

## Sauce in two sentences

You write a **program** in SauceScript, a small and strict TypeScript, and Sauce compiles it into
compact code for the chain you name. Your wallet sends that code in one transaction, a **cook**, to
your own account on chain, your **Pot**, where an **engine** already on chain runs every step of it.

## A program

This is the program the quick start runs, without its comments:

```js
function main(to: Address, amount: Uint256) {
  require(pot.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

It reads how much USDC your Pot holds, stops if that is less than `amount`, and pays `amount` to
`to`. Three things make it short:

- **`main`'s parameters are its inputs.** You give `to` and `amount` each time you run it, so one
  program serves every payment.
- **`USDC` is a name, not an address.** Sauce knows where USDC lives on each chain it runs on, and
  the same file runs on Base and on Solana.
- **`require` is a check.** A failed check stops and undoes the cook unless an EVM `try` catches it.

## How a program becomes one transaction

```text
pay.sauce.ts                  your program
     │  compile for a chain   each name becomes its address there; out comes bytecode
     ▼
bytecode, then main's arguments
     │  build the cook        to: your Pot   data: the program   value: the Kitchen's fee
     ▼
the cook, unsigned
     │  simulate              run it on a copy of the chain: free, nothing is sent
     │  sign and send         your wallet signs
     ▼
your Pot                      checks the owner's authorization, pays the Kitchen,
                              and has the engine run the program: every step, or none
```

1. **Compile.** The compiler checks every line, turns each name into its address on the chain you
   chose, and produces **bytecode**: Sauce's own compact code, which only a Sauce engine reads.
   There is no contract to write or deploy. The program is data, carried by the transaction.
2. **Build the cook.** The cook is an ordinary transaction to your Pot. It carries the program with
   `main`'s arguments after it, and as its value the **Kitchen**'s small fee. The Kitchen is the
   contract that makes Pots and charges that fee.
3. **Simulate.** Before anything is signed, the cook runs on a copy of the chain as it is right now.
   You see what would move, or why it would fail, for free.
4. **Sign and send.** Your wallet signs. Your key stays with you: Sauce builds the transaction, and
   the `sauce` command signs it with a wallet on your computer or hands it to another one.
5. **Run.** Your Pot checks the owner's authorization, pays the Kitchen, and has the engine
   run the program as the Pot. Every call the program makes comes from your Pot, and what it
   receives lands there. An uncaught failure reverts the transaction: nothing moves, and only
   the network fee is spent. EVM `try` blocks can roll back one attempt and run a recovery path.

## Why one transaction matters

Say you want to swap USDC for ETH and pay a friend what the swap returned. As two transactions,
the price can move between them, someone can act in between, and a failed second step leaves you
half done. As one program, the swap and the payment happen together or not at all, and nobody acts
between your steps.

A program is also more than a list of calls sent in a row. Between calls it reads balances and
results as they are at that moment, computes, and decides: it can measure what the swap actually
returned, refuse it below a minimum you set, and pay out exactly that.

## What Sauce is not

- **Not a contract you write.** You never write, audit or deploy a smart contract of your own. The
  engine and the Kitchen are already on chain, and your Pot is a standard account the Kitchen makes
  for you.
- **Not one protocol.** Sauce is not a wrapper around one exchange or lender. A program calls any
  of the 133 protocols Sauce knows, by name, and mixes them in one transaction.
- **Not a bridge.** A program runs on one chain. To move tokens to another, it calls a bridge
  protocol by name, such as Across or Circle's CCTP, as it calls any other.
- **Not a custodian.** Your private Pot requires your wallet's authorization for every program.
  New EVM Pots can accept an owner-signed cook submitted by another account; Sauce cannot
  move what your Pot holds without your authorization.
- **Not your application's code.** A program runs on chain, inside the transaction. It cannot call
  back into your application or read its variables, so everything it needs is given to it at the
  start, as `main`'s arguments.

## Where it runs

The `sauce` command sends transactions on **Ethereum**, **Base**, **Arc** and **Solana**, and on the
testnets **Arc Testnet**, **Base Sepolia**, **Ethereum Sepolia**, **Solana Devnet** and **Solana
Testnet**. Sauce knows 46 chains in all, testnets included. On
the others, the **preview chains**, a program compiles, and simulates
wherever the release is deployed, but nothing is sent. [Names and registries](names-and-registries.md) explains how a name such as `USDC`
finds its address on each chain.

## Three ways to use it

- **The `sauce` command**, in a terminal: compile, simulate and run a program. The tutorials use it.
- **The TypeScript package**, `@eco-incorp/sauce`: the same compiler and the same knowledge of
  chains, tokens and protocols, as a library for your application, in Node.js or a browser.
- **The MCP server**, `sauce mcp`: Sauce's commands as tools for a coding agent in your editor.

The [glossary](glossary.md) puts every Sauce word next to one you already know.

## Next

- Run a program for real: the [quick start](../guides/quick-start.md), the first tutorial.
- The Pot, the cook and the Kitchen in detail: [Kitchen, Pot and cook](kitchen-pot-cook.md).
