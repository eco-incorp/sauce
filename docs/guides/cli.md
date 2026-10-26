# The sauce command

**How-to guide** · [Documentation](../README.md) · [Quick start](quick-start.md) · [Command reference](../reference/cli.md)

> `sauce` is a command you type in a terminal. Think of it as the remote control for your **Pot**,
> your own account on the chain, which holds the tokens your programs spend. The command turns a
> program file into a transaction, tries it for free, signs it and sends it. It also has buttons for
> wallets and for looking things up on a chain.

This page is for anyone who has done the [quick start](quick-start.md) and now wants to set the
command up properly: install it, start a project, pick a chain and an endpoint, and keep it working.
It needs Node.js 24 or newer and a terminal, nothing else. Each command's own page is linked in the
table below, and [the command reference](../reference/cli.md) prints every flag.

## Install

```sh
npm install -g @eco-incorp/sauce
sauce --version
```

`sauce --version` prints the version. The command needs no other tool and no configuration, and it
reads no environment variable but one named as a password's source: by `--password-env`, or in
`sauce mcp` by an agent's `sauce_wallet_enable`. Every command takes `--help`, which prints what it
does and every flag it takes.

### Run it from a project

In a project that depends on the package (one `sauce init` wrote, or one where you ran
`npm i -D -E @eco-incorp/sauce`), `npx sauce <command>` runs the version the project's
`package.json` pins. A global `sauce` run in that project runs the global version instead.
`sauce skills status` reports skills that were installed from another version than the command's.

### Run it without installing

`npx -y @eco-incorp/sauce <command>` fetches the package and runs it. Never run a bare `npx sauce`
outside a project that depends on the package: npx then fetches and runs npm's unrelated `sauce`
package instead.

### Runtime packages

Two commands load packages that no install of `@eco-incorp/sauce` brings, because they are its
optional peer dependencies: `sauce mcp` (the MCP SDK and zod) and a Solana simulation in a local
copy (LiteSVM). Each uses your own copies where they are exactly the versions the package pins.
Otherwise its first use installs them for itself, once per version, into
`~/.sauce/runtime/<version>`, and says so on stderr.

- `sauce runtime` says where each command's packages come from, and `sauce runtime install`
  installs the folder now.
- `sauce mcp setup` installs it too, so an agent's first start of the server does not wait.
- `sauce mcp --offline` installs nothing. Without npm, or without its registry, the command
  refuses and says why.

The install runs `npm ci` on the lockfile the package ships, so every package is the one pinned,
checked by its integrity hash. The folder is owner-only and installed whole or not at all. The
command refuses to load from it if another user owns it or can write a folder above it. npm reaches
the registry your npm configuration names, a mirror or a proxy included. [Upgrading](upgrading.md)
says what happens to the folder when you update.

## Start a project

To start a new project, let the command make it:

```sh
sauce init my-app
cd my-app
npm install
```

`sauce init` writes:

- a `package.json` that pins `@eco-incorp/sauce` to exactly the version that ran it, `viem` to
  exactly the version installed beside it, and `@types/node` for the skills' TypeScript runners.
  The SDK's TypeScript API is written in viem's types, and a package manager that does not hoist
  dependencies (pnpm) resolves only a project's own;
- an `AGENTS.md` with the project's instructions for coding agents, and a `CLAUDE.md` and a
  `GEMINI.md` that import it for the two agents that read their own file;
- a `.gitignore` that keeps local configuration out of git, and `sauce.config.example.json`;
- `programs/tsconfig.json`, so an editor types the programs in `programs/`
  ([In an editor](cli-programs.md#in-an-editor));
- the agent skills, for every agent unless `--agent` names some ([Agent skills](skills.md)).

`init` refuses to overwrite a file that already has other content, and lists it, unless you pass
`--force`. It runs no package manager unless you pass `--install`.

## Find the right command

| Command          | What it does                                                         | Guide                                     |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| `sauce compile`  | Compile a program file and print its bytecode                        | [Programs and arguments](cli-programs.md) |
| `sauce simulate` | Run a program on a copy of the chain: no key, no money, nothing sent | [Run a program](cli-run.md)               |
| `sauce run`      | Compile, sign, send and wait for a program on your Pot               | [Run a program](cli-run.md)               |
| `sauce pot`      | Your Pot's address; create it; list the Pots you made                | [Run a program](cli-run.md)               |
| `sauce actions`  | Turn a JSON actions document into a program                          | [Programs and arguments](cli-programs.md) |
| `sauce wallet`   | Make, list and import the wallets `--wallet` signs with              | [Wallets and signing](cli-wallets.md)     |
| `sauce tx`       | Print the transaction unsigned, for another wallet to sign           | [Wallets and signing](cli-wallets.md)     |
| `sauce send`     | Send transactions signed elsewhere, and report what they did         | [Wallets and signing](cli-wallets.md)     |
| `sauce sign`     | Sign a cook for another account to send, or cancel one               | [Signed cooks](signed-cooks.md)           |
| `sauce reclaim`  | Close the upload buffers and lookup tables a Solana owner left open  | [Solana](cli-solana.md)                   |
| `sauce globals`  | The tokens, protocols and other names a program can use on a chain   | [Look things up](cli-lookup.md)           |
| `sauce price`    | Turn a price into the numbers a swap program takes                   | [Look things up](cli-lookup.md)           |
| `sauce pools`    | A pair's pools on a chain, deepest first, with their prices          | [Look things up](cli-lookup.md)           |
| `sauce inspect`  | Take a transaction, a call or a program apart                        | [Look things up](cli-lookup.md)           |
| `sauce verify`   | Check that a payload runs the audited settle program                 | [Look things up](cli-lookup.md)           |
| `sauce init`     | Start a project that uses the package                                | [Start a project](#start-a-project)       |
| `sauce skills`   | Install, update or check the agent skills in a project               | [Agent skills](skills.md)                 |
| `sauce mcp`      | Serve the commands to a coding agent                                 | [The MCP server](mcp.md)                  |
| `sauce update`   | Update this command, the way it was installed                        | [Upgrading](upgrading.md)                 |
| `sauce runtime`  | Install the extra packages `sauce mcp` and Solana simulations load   | [Runtime packages](#runtime-packages)     |

## Pick a chain and an endpoint

The command reads a chain through an **RPC endpoint**, the URL of a node that answers questions
about the chain. It sends transactions on four chains: **Ethereum**, **Base**, **Arc** and
**Solana**, and on two testnets: **Arc Testnet** (`arc-testnet`) and **Base Sepolia**
(`base-sepolia`). Every other chain it knows is a **preview chain**.
[Chains](../reference/chains.md) lists them all.

### Supported and preview chains

On Arc and Arc Testnet the native coin is USDC: gas, a cook's value and the Kitchen's fee are paid
in it, not ETH.

A testnet's coin and tokens have no value: try a program there before mainnet. Ethereum Sepolia
(`sepolia`) and Solana's devnet (`solana-devnet`, a chain of its own: its chain id is 1399811150
and its symbols are devnet's mints) are preview chains until the release is deployed there. On
`solana-devnet` `simulate` names the program the cluster lacks.

On a preview chain a program still compiles and every read works, but the command builds and
sends no transaction. `simulate` does not depend on the label: it runs wherever the release is
deployed on the chain, and stops with `the released engine … is not deployed on <chain>` where it
is not.

| On a preview chain                                                     | Does                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `compile`, `actions`, `globals`, `price`, `pools`, `inspect`, `verify` | What it does everywhere                                                        |
| `pot`                                                                  | Predicts the Pot, and with an endpoint reads it, but leaves the deployment out |
| `simulate`                                                             | Runs where the release is deployed on the chain; else stops with exit 1        |
| `tx`, `run`, `sign`, `pot --deploy`, `pot --format cast`               | Refused                                                                        |

A refusal comes before the command reaches an endpoint or reads a key. The command exits 1 and
says why, which chains are supported, and how to ask for the one it refused:

```text
sauce tx: building the cook transaction is refused: it involves optimism (Optimism, chain id 10), a preview chain. The sauce command and its MCP server build and send transactions only on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet and Base Sepolia. On a preview chain they build and send none. A program still compiles there and globals, price, pools and pot's prediction still read; simulate runs wherever the release is deployed on the chain, and says so where it is not.
To ask for Optimism: add your use case to its request if there is one (https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Optimism%22), or open one (https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Optimism+%2810%29&chain=Optimism&chain-id=10).
```

The first link finds the requests already filed for that chain. The second opens a new one, its
title, chain and chain id filled in.

`sauce pot` on a preview chain prints the Pot's address, owner, salt and Kitchen, but no `to`,
`data` or `value`. Its JSON adds `refused`, the same refusal as an object: `code`
(`"preview-chain"`), `action`, `message`, `supportedChains` and `previewChains`, each with its
`request`. No flag lifts the refusal.

### Your own endpoints

You don't have to give an endpoint: the command uses a built-in public one and says so on stderr.
Public endpoints can be slow or rate-limited, so for anything serious, use your own. Give one of
these:

- `--rpc-url <url>`, the endpoint of the chain the command is for; or
- `--config <file>`, a JSON file of endpoints by chain id. A chain it does not name is read through
  the built-in endpoint:

  ```json
  { "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
  ```

Give `--rpc-url` or `--config`, not both. `sauce init` writes `sauce.config.example.json` with `<…>`
placeholders. Copy it to `sauce.config.json`, which the project's `.gitignore` keeps out of git. A
placeholder left in is refused.

The command checks that an EVM endpoint serves the chain you named. It never prints your URL,
because a provider's URL often carries a key.

The built-in endpoints are one to three keyless ones per chain, each checked to serve the chain and
state overrides. When one cannot be reached, refuses, rate-limits or fails, the next takes over.
Kava, ZetaChain and Evmos have none. `--offline` reads no chain at all: `sauce tx` then needs
`--value`, and `sauce pot` only predicts.

## Keep the command current

`sauce update` installs the latest release the way the command was installed. After a global
update, the new version also updates the skills in the current directory and its runtime packages.
When a newer release is out, a command says so on stderr after it finishes.
[Upgrading](upgrading.md) covers both, and what changed in each release is in the
[changelog](../changelog.md).

### The update notice

After a command, one line on stderr says when a newer release is out. It never slows a command
down, it is off with `--offline` and `--no-update-check`, and it never touches `--json` output.
[Upgrading](upgrading.md#the-update-notice) says how it works and how to turn it off.

## Read the exit code

A mistyped command exits 2. A program that does not compile, a cook that reverts, a rejected
settle, an outdated skills install and a transaction on a preview chain exit 1. When a command
fails, [troubleshooting](troubleshooting.md) lists the messages a newcomer meets, with their causes
and fixes.

## Next

- Run your first program with everything explained: [Run a program](cli-run.md).
- Make the wallet that signs it: [Wallets and signing](cli-wallets.md).
- Write your own program: [Programs and arguments](cli-programs.md).
- What a Pot, a cook and the Kitchen are: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
