# Sauce

**Sauce lets you write a short program that does several things on a blockchain in one go, and
either all of it happens or none of it does.** Swap, then pay. Borrow, then repay. Check a price,
then trade. Then hand the rest to another chain.

You write the program in a small, safe slice of TypeScript. Sauce turns it into one transaction on
Ethereum, Base or Solana. You don't write or deploy a smart contract, and you don't look up
addresses: Sauce already knows the tokens and protocols on every chain it supports.

```js
// Pay `to` some USDC, but only if there is enough.
function main(to: Address, amount: Uint256) {
  require(USDC.balanceOf(ctx.self()) >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

The same file runs on Base and on Solana.

## What you can do with it

- **Do many steps as one.** A swap and a payment in a single transaction. If the swap gives too
  little, nothing moves at all.
- **Use protocols by name.** `UniswapV3.Factory`, `AaveV3.Pool`, `USDC`: 135 protocols and the
  main tokens of 41 chains, with no address to copy.
- **Try before you pay.** `sauce simulate` runs your program on a copy of the chain as it is right
  now. It needs no key and no money, and shows you what would move.
- **Reach another chain.** A program can post a job on another chain with a reward attached:
  "pay this person on Ethereum, and the reward waiting here on Base is yours".
- **Hand it to a coding agent.** An agent such as Claude Code or Codex can write and run programs
  for you, with Sauce's own tools.

## Start

```sh
npm install -g @eco-incorp/sauce
sauce --version
```

You need Node.js 24 or newer. Then do the [quick start](docs/guides/quick-start.md): write the
program above, try it for free, and run it on Base, in about ten minutes.

## The manual

The [documentation](docs/README.md) has four parts, and every page says at its top which one it is:

- **Tutorials** teach by doing: the [quick start](docs/guides/quick-start.md), the
  [Solana quick start](docs/guides/solana-quick-start.md) and
  [your first cross-chain intent](docs/guides/first-intent.md).
- **[How-to guides](docs/README.md#how-to-guides)** each get one task done: run a program, call a
  protocol, publish an intent, set up a coding agent.
- **[Concepts](docs/README.md#concepts)** explain how Sauce works. The
  [glossary](docs/concepts/glossary.md) puts each Sauce word next to one you already know.
- **[Reference](docs/README.md#reference)** lists the facts: every chain, protocol, token, function
  and option.

## Three words you will see

Sauce borrows its words from a kitchen. Your program is a recipe.

- **Pot**: your own smart account on chain. It belongs to your wallet, holds the tokens your
  programs spend, and makes every call they make. Only you can run programs on it.
- **Cook**: the transaction that runs one program on your Pot. Every step happens, or none does.
- **Kitchen**: the contract that makes Pots and charges a small flat fee for each cook.

Your Pot's address is known before it exists, so you can send it tokens right away. `sauce run`
creates it the first time it needs it.

## Supported chains

Sauce sends transactions on **Ethereum**, **Base** and **Solana**. Every other chain it knows is a
preview chain: programs compile and simulate there, but the `sauce` command sends nothing.
[Chains](docs/reference/chains.md) lists them all, and how to ask for one.

## From your application

Install it in a project instead, and the same compiler and registries are a TypeScript library.
It runs in Node.js and in a browser.

```sh
npm install @eco-incorp/sauce
```

This builds a cross-chain intent offline: a job on Base, with its reward on Ethereum. The creator
and the fee are fixtures, and nothing is sent.

```ts
import { Base } from "@eco-incorp/sauce";

const executionFee = 1_000n; // Fixture: read Base's Kitchen fee with destinationExecutionFee().

const built = Base(
  () => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  },
  { execution: { value: executionFee }, deadline: 2_000_000_000n },
).reward({
  source: "ethereum",
  creator: "0x4444444444444444444444444444444444444444",
  deadline: 2_000_003_600n,
});

console.log(built.hash().intentHash);
```

`USDC` and `Uniswap` are not imports: the compiler finds them on Base. `.reward(...)` returns the
intent's hash, its compiled program and the transactions your application sends. The
[API reference](docs/api/README.md) lists every import, and the [examples](docs/examples/README.md)
run on every release.

## With a coding agent

A coding agent uses Sauce through its MCP server, `sauce mcp`, which the agent starts on your
machine. Install the server's packages once, then add it:

```sh
sauce runtime install
claude mcp add sauce -- sauce mcp    # Claude Code
codex mcp add sauce -- sauce mcp     # OpenAI Codex
```

[The MCP server](docs/guides/mcp.md) covers other agents, and the wallets it can keep for an agent.
`sauce skills install` copies the package's [agent skills](docs/guides/skills.md), instructions
written for an agent, into your project.
