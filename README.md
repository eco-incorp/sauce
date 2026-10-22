# Sauce

**Sauce lets you write a short program in SauceScript, a subset of TypeScript, that reads live
onchain state, chooses a path and composes contract calls in one transaction.** Swap, then pay.
Borrow, then repay. Check a price, then trade. Your program enforces the conditions you write, an
unhandled failure reverts every step, and it runs through your own Pot, so you deploy no contract
for each program.

This README is for developers who know TypeScript and the basic ideas of a blockchain (a wallet, a
transaction, a token) and have never used Sauce. You need nothing else to start.

## What Sauce is, and is not

You write the program in a small, safe slice of TypeScript called SauceScript. Sauce turns it into
one transaction on Ethereum, Base or Solana, and an engine already on chain runs every step of it
inside that transaction. Here is a whole program, the one the quick start runs:

```js
// Pays `amount` of USDC from your Pot to `to`, and stops if the Pot holds less.
// The same file runs on Base and on Solana.
//
// Try it on a copy of the chain first: no password, no money, nothing sent.
//
//   sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 --args <recipient> 1000000
//
// Then run it for real: your wallet signs and pays the fee, and your Pot pays the USDC.
//
//   sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
//
// On Solana, the same way, with a Solana wallet:
//
//   sauce simulate pay.sauce.ts --chain solana --wallet me-solana --assume-balance USDC:5 --args <recipient> 1000000
//   sauce run pay.sauce.ts --chain solana --wallet me-solana --args <recipient> 1000000
//
//   to: Address       who gets the USDC, an address on the chain it runs on
//   amount: Uint256   how much, in USDC's smallest unit: USDC has 6 decimals, so 1000000 is 1 USDC
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

`main` is where the program starts, and its parameters are the inputs you give each time you run
it. `require` stops the whole transaction when its check fails, so nothing moves. `USDC` needs no
address and no import: Sauce knows it on each chain.

What Sauce is not:

- **Not a contract you write.** You never write, audit or deploy a smart contract of your own.
  Your program runs on your **Pot**, a small account on chain that belongs to your wallet.
- **Not one protocol.** Sauce is not a wrapper around a single exchange or lender. A program calls
  any of the protocols Sauce knows, by name, and mixes them in one transaction.
- **Not a custodian.** Your keys stay with you. Sauce builds the transaction, and your wallet signs
  it.

## What you can do with it

- **Do many steps as one.** A swap and a payment in a single transaction. If the swap gives too
  little, nothing moves at all.
- **Use protocols by name.** `UniswapV3.Factory`, `AaveV3.Pool`, `USDC`: Sauce knows 134 protocols
  across 41 chains, and the main tokens of 14 of those chains, with no address to copy. On a chain
  with no named token, a program writes the token's address once.
- **Try before you pay.** `sauce simulate` runs your program on a copy of the chain as it is right
  now. It needs no key and no money, and shows you what would move.
- **Hand it to a coding agent.** The agent in your editor can write, simulate and run programs for
  you, with Sauce's own tools.

## Start

```sh
npm install -g @eco-incorp/sauce
sauce --version
```

You need Node.js 24 or newer. Then do the [quick start](docs/guides/quick-start.md): write the
program above, try it for free, and run it on Base, in about ten minutes. Only the last step spends
money: a little ETH for the fee and 1 USDC, on Base.

## The learning path

The [documentation](docs/README.md) is written to be followed in order. Read
[What Sauce is](docs/concepts/what-is-sauce.md) for the picture, then do the seven tutorials:

1. Quick start: install, try a program for free, run it on Base.
2. Write your first program: inputs, checks and transfers of your own.
3. Swap by name: trade through protocols you name, and set the least you will accept.
4. Solana quick start: the same program on Solana.
5. Sauce from TypeScript: compile programs and build their transactions in your own code.
6. Test your first program: run a program in your tests, on a local copy of a chain.
7. Your first agent session: let a coding agent write and simulate a program.

Each tutorial ends with a link to the next one. After the path, the manual's how-to guides each
get one task done, its concepts explain how Sauce works, and its reference lists every chain,
protocol, token, command and import. The [glossary](docs/concepts/glossary.md) puts each Sauce word
next to one you already know.

When something fails, [Troubleshooting](docs/guides/troubleshooting.md) says what an error means
and what to do. The [changelog](docs/changelog.md) records what each SDK release changed in
SauceScript, the compiler and the engines.

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

This compiles a program for Base offline: it approves Aave V3's pool for `amount` of USDC and
supplies it. Nothing is sent.

```ts
import { routes } from "@eco-incorp/sauce";

const program = routes.compileSauceProgram(
  "base",
  `function main(amount: Uint256) {
    USDC.approve(AaveV3.Pool, amount);
    AaveV3.Pool.supply(USDC, amount, ctx.self(), 0);
  }`,
);

// What a Pot cooks: the bytecode, with main's argument appended.
const args = routes.encodeEntryArguments(program, [1_000_000n]);
console.log(`${program.bytecode.length} bytes, plus ${args.length} of arguments`);
console.log(program.entryParams.map((p) => `${p.name}: ${p.type}`).join(", "));
```

`USDC` and `AaveV3` are not imports: the compiler finds them on Base. `entryParams` is what `main`
takes, and the bytecode with its encoded arguments is what your Pot runs.
[Sauce from TypeScript](docs/guides/typescript-quick-start.md) walks through it, the
[API reference](docs/api/README.md) lists every import, and the [examples](docs/examples/README.md)
run on every release.

## With a coding agent

A coding agent uses Sauce through its MCP server, `sauce mcp`, a plugin the agent starts on your
machine that gives it Sauce's commands as tools. Add it to your project once:

```sh
sauce mcp setup
```

That writes the server into the configuration file of each coding agent the command knows. The
server installs the few packages it needs the first time it starts; `sauce runtime install` does
that ahead of time, and is optional.

[Your first agent session](docs/guides/agent-quick-start.md) walks through a session, and
[the MCP server](docs/guides/mcp.md) covers each agent and the wallets it can keep for one.
`sauce skills install` copies the package's [agent skills](docs/guides/skills.md), instructions
written for an agent, into your project.
