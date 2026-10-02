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

## Supported chains

For the initial release, Sauce supports transactions on **Ethereum**, **Base** and **Solana**.
Every other chain in the registry is a preview chain: programs compile for it and the `sauce`
command and MCP server simulate and rehearse them there, but they build and send no transaction on
it. The TypeScript SDK is not gated — its builders still build transactions for every registry
chain, at the integrator's own risk. To ask for another chain,
[search the existing requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)
and add your use case, or
[open a chain-support request](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml).
[Supported chains](docs/README.md#supported-chains) has the details.

## A program that creates a cross-chain intent

A program can spend an intent's funds, and it can also create the next intent. That is where the
runtime and the routes layer meet. This program measures an amount nobody knew in advance and offers
an intent carrying it onward.

```js
// Create a cross-chain intent from inside a Sauce program.
//
// This runs on one chain as part of an intent's route, measures what the calls before it left in
// the Pot, and offers a NEW intent that carries that amount onward to another chain. The amount is
// never known in advance — it is whatever the swap, bridge or transfer just before it produced —
// which is the reason to build the intent here rather than off-chain.
//
// `Arbitrum(() => { ... }).reward({ ... })` is the whole of it. `amount` is an ordinary variable of
// this program, and using it inside the intent is enough: the SDK splices its run-time value into
// the encoded intent, and fills in the Portal, the prover, the approval and the encoding.
//
// RECIPIENT is a compile-time `define` the caller supplies. `USDC` is a registered symbol, and
// inside the braces it means Arbitrum's USDC, because that is the chain those calls run on. In
// `.reward(...)` it means the USDC of the chain this program runs on, which escrows the reward.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  if (amount < MIN_AMOUNT) {
    throw "cross-chain-intent: nothing to forward";
  }

  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
```

That is the whole program. What you did not have to do:

- **Write or deploy a contract.** It compiles to bytecode that a Sauce engine runs in the shared
  Pot the solver deploys.
- **Import anything.** `USDC`, `Arbitrum` and `ctx` need no import line.
- **Encode the intent.** No Portal, prover, selector, approval or ABI encoding appears. The SDK
  looks up the Portal and prover in its eco-routes deployment tables and emits the rest.
- **Know the amount in advance.** `amount` is an ordinary variable, and the published intent
  carries the value the program measured.
- **Roll back by hand.** Below `MIN_AMOUNT` the `throw` reverts the whole fulfilment: nothing is
  published, and no earlier call in the route survives.

Without Sauce, this hop is either a contract you write and deploy (read the balance, encode the
intent around the amount, ask the Portal for its vault, pay the reward into it, call `publish`) or
a second intent you publish yourself after the first lands and you have read what it produced.

`USDC` is a registered token symbol, and inside the braces it means **Arbitrum's** USDC, because
that is where those calls run. In `.reward(...)` it means the USDC of the chain the program runs
on — Base, in [the caller](docs/examples/cross-chain-intent.ts) — because the program escrows the
reward there. `RECIPIENT` and `MIN_AMOUNT` are compile-time `defines`: a program captures nothing
from the JavaScript around it, so defines are how application values reach one.

You supply what the SDK cannot know once, on the enclosing intent, and every intent the program
creates inherits it: a deadline, and the creator who may reclaim the reward if nobody earns it. The
intent is an offer; a solver still decides to fill it. Arbitrum is a
[preview chain](docs/README.md#supported-chains) for the initial release: the SDK builds this
intent, and the `sauce` command and MCP server compile and rehearse it, but they publish intents
only between Ethereum, Base and Solana.
[docs/examples/cross-chain-intent.ts](docs/examples/cross-chain-intent.ts) is the caller, run on
every release; [nested intents](docs/guides/nested-intents.md) covers cascades several hops deep.

## A program that calls protocols and tokens by name

Inside a route body the SDK resolves token symbols and protocol contracts against the destination
chain, so a program reads like the operation it performs. This example builds a complete intent
offline; the creator and the fee are fixtures and nothing is sent.

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

What the snippet leaves out, the SDK fills in from what it records: the eco-routes Portal on both
chains, the prover for the pair, the destination Pot and engine, and the native amount the solver
sends, which is the cook's fee. The options take any of them as an override. What stays yours are
the deadlines, the creator, the reward and the fee, which is on-chain state the destination's
Kitchen sets: `destinationExecutionFee()` builds the read.

Two kinds of name meet in that snippet. `Base` is a **named export**, one per chain; importing the
package puts nothing on `globalThis`. `USDC` and `Uniswap` are **program syntax**: the SDK resolves
them to Base's addresses and binds the ABI, so there is no address to look up and no JavaScript
object to import. The callback is read as source text and never invoked, so it captures nothing;
application values reach it through `defines`.

`.reward(...)` completes the intent and returns its hashes, bytecode and the Portal transaction
requests your application submits. [Quick start](docs/guides/quick-start.md) walks through it, and
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

## What else is in the package

| You want to                                         | Start at                                          |
| --------------------------------------------------- | ------------------------------------------------- |
| Build, fund and submit an intent                    | [Create an intent](docs/guides/intents.md)        |
| Open an intent from inside another intent's body    | [Nested intents](docs/guides/nested-intents.md)   |
| Generate programs from data instead of writing them | [Builders](docs/guides/builders-and-actions.md)   |
| Compile a standalone program with runtime arguments | [Compiling programs](docs/guides/compiling.md)    |
| Compile and run a program file from a terminal      | [The sauce command](docs/guides/cli.md)           |
| Have a coding agent write and run programs          | [Agent skills](docs/guides/cli.md#agent-skills)   |
| Give a coding agent Sauce's tools over MCP          | [The MCP server](docs/guides/mcp.md)              |
| Give an agent a wallet of its own, with limits      | [Agent wallets](docs/guides/cli.md#agent-wallets) |
| Execute on Solana                                   | [Solana](docs/guides/solana.md)                   |
| Check what a settlement payload contains            | [Verification](docs/guides/verification.md)       |
| Know which protocols, tokens and chains are wired   | [Coverage](docs/api/coverage.md)                  |

The SauceScript compiler ships inside this package; there is no separate install and no compiler
checkout. [Architecture](docs/concepts/architecture.md) explains how the pieces fit,
[SauceScript](docs/concepts/saucescript.md) the language itself.
