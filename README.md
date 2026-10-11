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

That install is the library alone. The MCP SDK, zod and LiteSVM, which only `sauce mcp` and Solana
rehearsals load, are optional peer dependencies it never brings: those commands install them for
themselves, once per version, into `~/.sauce/runtime/`
([Runtime packages](docs/guides/cli.md#runtime-packages)).

For the [`sauce` command](docs/guides/cli.md), install the package once globally:

```sh
npm i -g @eco-incorp/sauce
sauce --version
```

`npm i -g @eco-incorp/sauce@latest` upgrades it, and [Install](docs/guides/cli.md#install) has the
other ways to run it.

A coding agent uses Sauce through its MCP server, `sauce mcp`, which the agent starts on your
machine. Install its packages once with `sauce runtime install`, then add it:

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

You fund your Pot like any address, and `sauce run` sends a cook, deploying the Pot first when it
first needs it (it asks, or `--yes`).
[Kitchen, Pot and cook](docs/concepts/kitchen-pot-cook.md) explains each, who may do what with a
Pot, and the shared Pot an intent's body runs on.

## Supported chains

For the initial release, Sauce supports transactions on **Ethereum**, **Base** and **Solana**.
Every other chain in the registry is a preview chain: programs compile for it, and the `sauce`
command and the MCP server rehearse them there but build and send no transaction.
[Chains](docs/reference/chains.md) has the policy, every chain's tokens and protocols, and how to
request a chain.

## A program that calls protocols and tokens by name

The SDK resolves token symbols and protocol contracts against the chain a program is compiled for,
so a program reads like the operation it performs. From TypeScript, this example compiles a program
for Base that approves Uniswap's router, offline; nothing is sent.

```ts
import { routes } from "@eco-incorp/sauce";

const program = routes.compileSauceProgram(
  "base",
  `function main(amount: Uint256) {
    USDC.approve(Uniswap.UniversalRouter, amount);
  }`,
);

// What a Pot cooks: the bytecode, with main's argument appended.
const args = routes.encodeEntryArguments(program, [1_000_000n]);
console.log(`${program.bytecode.length} bytes, plus ${args.length} of arguments`);
```

What you did not have to do:

- **Write or deploy a contract.** It compiles to bytecode that a Sauce engine runs in your Pot.
- **Import anything into the program.** `USDC` and `Uniswap` are **program syntax**: the SDK
  resolves them to Base's addresses and binds the ABI, so there is no address to look up and no
  JavaScript object to import.
- **Compile once per amount.** `amount` is `main`'s parameter: it arrives with the cook, so one
  compiled program serves every call.

`sauce run` sends the same program as a cook from a terminal (`--args` gives `main`'s arguments).
[Quick start](docs/guides/quick-start.md) walks through it, and
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
- [Quick start](docs/guides/quick-start.md): compile a first program, offline.
- [The sauce command](docs/guides/cli.md): compile, rehearse and run from a terminal.
- [Agent skills](docs/guides/skills.md): the skills that teach a coding agent to write and run
  programs, beside [the MCP server](docs/guides/mcp.md).
- [Chains](docs/reference/chains.md), [protocols](docs/reference/protocols.md) and
  [tokens](docs/reference/tokens.md): what a program can name, and where.

The SauceScript compiler ships inside this package; there is no separate install and no compiler
checkout. [Architecture](docs/concepts/architecture.md) explains how the pieces fit,
[SauceScript](docs/concepts/saucescript.md) the language itself.
