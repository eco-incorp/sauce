# Sauce

**Sauce is a programmable-transaction runtime.** You write a program, it compiles to bytecode, and a
Sauce engine executes it atomically inside one transaction on EVM or Solana. Either the whole
program lands or none of it does.

`@eco-incorp/sauce` is the developer package for that runtime: the compiler, the chain and protocol
knowledge a program needs, and the builders that turn a program into a transaction.

On top of the runtime sits a second layer — **routes**. A route packages a program as an Eco intent:
an offer to have that program executed on another chain, with a reward escrowed here for whoever
executes it there. Cross-chain execution is this layer, not the runtime.

```sh
npm install @eco-incorp/sauce
```

Node.js **24 or newer**, or a browser — [one `await ready()`](docs/api/compiler.md#in-a-browser) and the
same code compiles the same bytes.

For the [`sauce` command](docs/guides/cli.md), install the package once globally:

```sh
npm i -g @eco-incorp/sauce
sauce --version
```

`npm i -g @eco-incorp/sauce@latest` upgrades it, and [Install](docs/guides/cli.md#install) has the
other ways to run it.

A coding agent uses Sauce through its MCP server, `sauce mcp`, which the agent starts on your
machine. Add it once:

```sh
claude mcp add sauce -- sauce mcp    # Claude Code
codex mcp add sauce -- sauce mcp     # OpenAI Codex
```

[The MCP server's quick start](docs/guides/mcp.md#quick-start) covers Gemini CLI, Claude Desktop,
Cursor and VS Code, and how to check that it worked.

[Documentation](docs/README.md) · [Quick start](docs/guides/quick-start.md) ·
[Examples](docs/examples/README.md) · [API reference](docs/api/README.md)

## Kitchen, Pot and cook

Three words name where a program runs, and every guide uses them:

- **Pot**: your account on chain, a small contract the Kitchen creates for you. It holds the tokens
  your programs spend, every call a program makes comes from it, and only you can run programs on
  it. Its address follows from yours, so it is known before it exists.
- **Cook**: the transaction that runs one program on your Pot, `cook(engine, program)` sent to the
  Pot. The engine executes the program as the Pot, every step or none, and `ctx.self()` in the
  program is the Pot.
- **Kitchen**: the contract that creates Pots and sets the flat fee every cook pays, in the chain's
  native coin.

`sauce pot --deploy` creates your Pot, you fund it like any address, and `sauce run` sends a cook.
[Kitchen, Pot and cook](docs/concepts/kitchen-pot-cook.md) explains each, who may do what with a
Pot, and the shared Pot an intent's body runs on.

## Supported chains

For the initial release, Sauce supports transactions on **Ethereum**, **Base** and **Solana**.
Every other chain in the registry is a preview chain: programs compile for it, and the `sauce`
command and the MCP server rehearse them there but build and send no transaction.
[Chains](docs/reference/chains.md) has the policy, every chain's tokens and protocols, and how to
request a chain.

## A program that creates a cross-chain intent

A program can spend what a Pot holds, and it can also create the next intent. That is where the
runtime and the routes layer meet. This program measures an amount nobody knew in advance and offers
an intent carrying it onward.

```js
// Create a cross-chain intent from inside a Sauce program.
//
// This runs on your Pot, measures the USDC the calls before it left there, and offers a NEW intent
// that carries that amount to `recipient` on another chain. The amount is never known in advance —
// it is whatever the swap, bridge or transfer just before it produced — which is the reason to
// build the intent here rather than off-chain.
//
// `await Ethereum.hop({ reward, receive, refundee })` is the whole of it: the reward this program
// escrows, what a solver delivers on Ethereum, and, after it, what runs there. `amount` is
// an ordinary variable of this program and `recipient` one of its parameters, and using them in the
// intent is enough: the program encodes the intent as it runs, with their values, and the SDK fills
// in the Portal, the prover, the vault and the encoding. The intent names its refundee, `refundTo`,
// where its reward goes back if no solver fills it: no intent has a default refundee. The body runs
// on Ethereum as a program, on the Pot every intent there shares, and its cook pays Ethereum's
// Kitchen fee, which the command reads there. The deadlines and the salt take their defaults.
//
// `USDC` is a registered symbol. In the body it means Ethereum's USDC, the chain the body runs on,
// and so it does in `receive`, whose tokens are looked up again on Ethereum by symbol (its amounts
// are computed here). In `reward` it means the USDC of the chain this program runs on, which
// escrows the reward.
//
//   sauce run cross-chain-intent.sauce.ts --chain base --keystore <keystore> \
//     --args <recipient> <minAmount> <refundTo>
//
//   recipient: Address   who the intent pays on Ethereum
//   minAmount: Uint256   the least USDC worth forwarding, in its smallest units (6 decimals):
//                        below it the whole transaction reverts and nothing is published
//   refundTo: Address    who reclaims the reward if no solver earns it
function main(recipient: Address, minAmount: Uint256, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  require(amount >= minAmount, "nothing to forward");

  await Ethereum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount },
    refundee: refundTo,
  });
  USDC.transfer(recipient, amount); // on Ethereum
}
```

That is the whole program. What you did not have to do:

- **Write or deploy a contract.** It compiles to bytecode that a Sauce engine runs in your Pot.
- **Import anything.** `USDC`, `Ethereum` and `ctx` need no import line.
- **Encode the intent.** No Portal, prover, selector, approval or ABI encoding appears. The SDK
  looks up the Portal and prover in its eco-routes deployment tables and emits the rest.
- **Know the amount in advance.** `amount` is an ordinary variable, and the published intent
  carries the value the program measured.
- **Roll back by hand.** Below `minAmount` the `require` reverts the whole transaction: nothing is
  published.

Without Sauce, this step is either a contract you write and deploy (read the balance, encode the
intent around the amount, ask the Portal for its vault, pay the reward into it, call `publish`) or
a second transaction you build yourself after reading what the first produced.

`await Ethereum.hop({ … })` opens the intent, and the statements after it are the body, which runs
on Ethereum, so a hop to one chain and on to the next reads top to bottom. As in JavaScript, it is
`Ethereum.hop({ … }).then(() => { … })`.

`USDC` is a registered token symbol. In the body it means **Ethereum's** USDC, because that is where
the body runs, and in `receive` only the tokens are Ethereum's, looked up again there by symbol,
while every other value, an amount included, is computed where the intent opens. In `reward` it
means the USDC of the chain the program runs on — Base, in the line above — because the program
escrows the reward there. `recipient`,
`minAmount` and `refundTo` are `main`'s parameters: they arrive with the transaction (`--args`), so
one compiled program serves every call.

`refundee: refundTo` is the refund address: who reclaims the reward if nobody earns it. A program
names it for every intent it opens, since the Pot it runs on may be shared. Everything else has a
default: the deadlines count from when the intent opens, the salt is random, and Ethereum's
Kitchen fee, which a body that is a program pays, is read from Ethereum. Each has a field of its
own ([Intent defaults](docs/reference/intent-defaults.md)). The intent is an offer; a solver still
decides to fill it. [docs/examples/cross-chain-intent.ts](docs/examples/cross-chain-intent.ts)
builds the same transaction from TypeScript, and runs on every release;
[nested intents](docs/guides/nested-intents.md) opens one intent inside another's body, and covers
cascades several hops deep.

## A program that calls protocols and tokens by name

Inside a program the SDK resolves token symbols and protocol contracts against the chain it runs
on, so a program reads like the operation it performs. From TypeScript, this example builds an
intent whose body approves Uniswap's router on Base, offline; the refundee, the owner and the fees
are fixtures and nothing is sent.

```ts
import { Base, Ethereum } from "@eco-incorp/sauce";

const owner = "0x4444444444444444444444444444444444444444";
const kitchenFee = 1_000n; // Fixture: read each Kitchen's fee with destinationExecutionFee().

const built = Base.hop({
  source: Ethereum,
  reward: { token: Ethereum.USDC.address, amount: 10_000n },
  refundee: owner,
  fee: kitchenFee,
}).then(() => {
  USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
});

// The cook that publishes it from your Pot on Ethereum: { to, data, value }.
const cook = built.cook({ owner }, kitchenFee);
console.log(`${built.program.bytecode.length} bytes, cooked on ${cook.to}`);
```

`.then(...)` writes the statement a program opens the intent with, compiles it for Ethereum and
returns the program and its cook. The Pot pays the reward into the intent's vault and publishes it,
so it must hold the reward when the cook runs. What the snippet leaves out, the SDK fills in from
what it records: the eco-routes Portal on both chains, the prover for the pair, the destination Pot
and engine, the native amount the solver sends, which is the body's cook fee, the deadlines, counted
from when the cook runs, and a random salt. What stays yours are the refundee, the reward and the
fees, which are on-chain state each chain's Kitchen sets: `destinationExecutionFee()` builds the
read. The intent's hash is the one the Portal announces when the cook publishes it:
`built.intents(receipt.logs)` reads it from the receipt, or from a rehearsal's logs.

Two kinds of name meet in that snippet. `Base` and `Ethereum` are **named exports**, one per chain;
importing the package puts nothing on `globalThis`. `USDC` and `Uniswap` in the body are **program
syntax**: the SDK resolves them to Base's addresses and binds the ABI, so there is no address to
look up and no JavaScript object to import. The callback is read as source text and never invoked,
so it captures nothing; an application value is written into it as a literal, or passed as a define
(`compile: { defines }`). [Quick start](docs/guides/quick-start.md) walks through it, and
[protocols and tokens](docs/guides/protocols-and-tokens.md) covers the names available.

## Agent wallets

An agent with no wallet can make one, through the `sauce` command or the local MCP server, and
keep it. The key is encrypted under a password the agent holds in its `.env` or secret store; the
command and the server read the password from the source they are told about, so it is never a
command-line argument or a tool input, and it never reaches the model's context:

```sh
sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD
sauce run pay.sauce.ts --chain base \
  --wallet agent --password-env SAUCE_WALLET_PASSWORD --args <recipient> 1000000
sauce mcp --wallets --password-env SAUCE_WALLET_PASSWORD
```

An EVM wallet is a standard keystore that `cast wallet` and geth read too. A policy file beside a
wallet limits what it sends, per transaction and per day, by chain, by recipient, in the native
coin and per token. These are hot wallets: keep small balances in them.
[Agent wallets](docs/guides/cli.md#agent-wallets) covers the command, and
[the MCP server's](docs/guides/mcp.md#agent-wallets) its tools. The HTTP server never signs.

## Where to go next

- [Documentation](docs/README.md): every guide and reference page, one line each.
- [Quick start](docs/guides/quick-start.md): build a first intent, offline.
- [The sauce command](docs/guides/cli.md): compile, rehearse, run and publish from a terminal.
- [Agent skills](docs/guides/skills.md): the skills that teach a coding agent to write and run
  programs, beside [the MCP server](docs/guides/mcp.md).
- [Chains](docs/reference/chains.md), [protocols](docs/reference/protocols.md) and
  [tokens](docs/reference/tokens.md): what a program can name, and where.

The SauceScript compiler ships inside this package; there is no separate install and no compiler
checkout. [Architecture](docs/concepts/architecture.md) explains how the pieces fit,
[SauceScript](docs/concepts/saucescript.md) the language itself.
