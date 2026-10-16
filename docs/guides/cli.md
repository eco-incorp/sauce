# The sauce command

**How-to guide** · [Documentation](../README.md) · [Quick start](quick-start.md) · [Command reference](../reference/cli.md)

> `sauce` is a command you type in a terminal. Think of it as the remote control for your Pot: it
> turns a program file into a transaction, tries it for free, signs it and sends it. It also has
> buttons for wallets, for intents, and for looking things up on a chain. New here? The
> [quick start](quick-start.md) walks you through your first program.

## Install

```sh
npm install -g @eco-incorp/sauce
sauce --version
```

You need Node.js 24 or newer. The command needs no other tool and no configuration, and it reads
no environment variable you did not name.

## What it does

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
| `sauce reclaim`  | Close the upload buffers and lookup tables a Solana owner left open  | [Solana](cli-solana.md)                   |
| `sauce intent`   | Publish, fill, prove, claim, refund and cancel cross-chain intents   | [Intents](cli-intents.md)                 |
| `sauce globals`  | The tokens, protocols and other names a program can use on a chain   | [Look things up](cli-lookup.md)           |
| `sauce price`    | Turn a price into the numbers a swap program takes                   | [Look things up](cli-lookup.md)           |
| `sauce pools`    | A pair's pools on a chain, deepest first, with their prices          | [Look things up](cli-lookup.md)           |
| `sauce inspect`  | Take a transaction, a call or a program apart                        | [Look things up](cli-lookup.md)           |
| `sauce verify`   | Check that a payload runs the audited settle program                 | [Look things up](cli-lookup.md)           |
| `sauce init`     | Start a project that uses the package                                | [Install](#other-ways-to-run-it)          |
| `sauce skills`   | Install, update or check the agent skills in a project               | [Agent skills](skills.md)                 |
| `sauce mcp`      | Serve the commands to a coding agent                                 | [The MCP server](mcp.md)                  |
| `sauce update`   | Update this command, the way it was installed                        | [Updates](#updates)                       |
| `sauce runtime`  | Install the extra packages `sauce mcp` and Solana simulations load   | [Runtime packages](#runtime-packages)     |

Every command takes `--help`, and the [command reference](../reference/cli.md) collects them all.

## Which chains

The command sends transactions on three chains: **Ethereum**, **Base** and **Solana**. Every other
chain it knows is a **preview chain**. There a program still compiles and simulates, and every read
works, but the command builds and sends nothing. [Chains](../reference/chains.md) lists them all.

## Endpoints

To read a chain, the command needs an RPC endpoint. You don't have to give one: it uses a built-in
public endpoint and says so. Public endpoints can be slow or rate-limited, so for anything serious,
use your own.

## Details

### Supported and preview chains

| On a preview chain                                                                                                                  | Does                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `compile`, `actions`, `simulate`, `globals`, `price`, `pools`, `inspect`, `verify`, `intent status`, `intent import`, `intent list` | What it does everywhere                                                        |
| `intent publish --dry-run`, `intent fill` without `--send`                                                                          | Simulates, sending nothing                                                     |
| `pot`                                                                                                                               | Predicts the Pot, and with an endpoint reads it, but leaves the deployment out |
| `tx`, `run`, `pot --deploy`, `pot --format cast`                                                                                    | Refused                                                                        |
| `intent publish`, also with `--format`; `intent fill --send`; `intent prove`, `claim`, `refund`, `cancel`                           | Refused                                                                        |

A refusal comes before the command reaches an endpoint or reads a key. The command exits 1 and
says why, which chains are supported, and how to ask for the one it refused:

```text
sauce tx: building the cook transaction is refused: it involves optimism (Optimism, chain id 10), a preview chain. For the initial release, the sauce command and its MCP server build and send transactions only on Ethereum, Base and Solana. On a preview chain a program still compiles, and simulate and dry runs still run it.
To ask for Optimism: add your use case to its request if there is one (https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Optimism%22), or open one (https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Optimism+%2810%29&chain=Optimism&chain-id=10).
```

The first link finds the requests already filed for that chain. The second opens a new one, its
title, chain and chain id filled in.

`sauce pot` on a preview chain prints the Pot's address, owner, salt and Kitchen, but no `to`,
`data` or `value`. Its JSON adds `refused`, the same refusal as an object: `code`
(`"preview-chain"`), `action`, `message`, `supportedChains` and `previewChains`, each with its
`request`. `sauce --help` and the `--help` of every refused command say the same. No flag lifts
the refusal.

### Your own endpoints

Give one of these:

- `--rpc-url <url>`, the endpoint of the chain the command is for; or
- `--config <file>`, a JSON file of endpoints by chain id. A chain it does not name is read through
  the built-in endpoint:

  ```json
  { "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
  ```

`sauce init` writes `sauce.config.example.json` with `<…>` placeholders. Copy it to
`sauce.config.json`, which the project's `.gitignore` keeps out of git. A placeholder left in is
refused.

The command checks that an EVM endpoint serves the chain you named. It never prints your URL,
because a provider's URL often carries a key.

The built-in endpoints are one to three keyless ones per chain, each checked to serve the chain and
state overrides. When one cannot be reached, refuses, rate-limits or fails, the next takes over.
Kava, ZetaChain and Evmos have none. `--offline` reads no chain at all: `sauce tx` then needs
`--value`, and `sauce pot` only predicts.

### Other ways to run it

The global install is how this manual writes every command, `sauce …`. Two other ways run the same
command:

- **A project's pinned copy.** In a project that depends on the package (one `sauce init` wrote, or
  `npm i -D -E @eco-incorp/sauce`), `npx sauce <command>` runs the version its `package.json` pins.
  A global `sauce` there runs the global version, and `sauce skills status` reports skills installed
  from another version than the command's.
- **No install.** `npx -y @eco-incorp/sauce <command>` fetches the package and runs it. Never run a
  bare `npx sauce` outside a project that depends on the package: npx then fetches and runs npm's
  unrelated `sauce` package instead.

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
- an `AGENTS.md` with the project's instructions for coding agents, and the agent skills
  ([Agent skills](skills.md));
- a `.gitignore` that keeps local configuration out of git, and `sauce.config.example.json`;
- `programs/tsconfig.json`, so an editor types the programs in `programs/`
  ([In an editor](cli-programs.md#in-an-editor)).

`init` refuses to overwrite a file that already has other content, and lists it, unless you pass
`--force`. It runs no package manager unless you pass `--install`.

### Updates

`sauce update` upgrades the command to the latest release (or `--version <version>`), the way it
was installed. A global install by npm, pnpm, yarn or bun is installed again by that manager, and
skills installed in the current directory are then updated by the new `sauce`. A project's own copy
is the project's to update, so `sauce update` prints the command its package manager takes and
changes nothing. A copy in npx's cache prints the `npx -y` command. `sauce update --check` says
which version is installed and which is the latest, and installs nothing.

### The update notice

After a command, one line on stderr says when a newer release is out:

```text
sauce 0.99.12 → 0.99.13 is available: run `sauce update`
```

It never slows a command down. The line comes from a cache, `~/.sauce/update-check.json`
(owner-only), which `sauce` refreshes from the npm registry at most once a day, in a process of its
own that no command waits for. So the first command after a release may say nothing yet. The
registry is the only host it reads. The line goes to stderr only, so `--json` output and anything
piped from stdout stay as they are. It names a newer release only, and a prerelease only to a
prerelease.

Nothing is shown, and nothing read, with `--offline`. To turn it off:

- pass `--no-update-check`. Every command takes it, and so does `sauce` before the command, so a
  shell alias can carry it: `alias sauce='sauce --no-update-check'`;
- or add `"updateCheck": false` to the `--config` file a command is given
  (`{ "rpcUrls": { … }, "updateCheck": false }`).

`sauce mcp` prints no notice: it puts one note in its first tool result instead
([A newer version](mcp.md#a-newer-version)).

### Runtime packages

Two commands load packages that no install of `@eco-incorp/sauce` brings, because they are its
optional peer dependencies: `sauce mcp` (the MCP SDK and zod) and a Solana simulation in a local
copy (LiteSVM). Each takes your own copies where they are exactly the versions the package pins.
Otherwise its first use installs them for itself, once per version, into
`~/.sauce/runtime/<version>`, and says so on stderr. That is `npm ci` on the lockfile the package
ships, so every package is the one pinned, checked by its integrity hash, and LiteSVM's native
binary is your platform's.

- `sauce runtime` says where each command's packages come from. `sauce runtime install` installs
  the folder now.
- `sauce mcp setup` installs it too, so an agent's first start of the server does not wait.
  `sauce update` has the new version install its own folder where the version it replaces had one.
- `sauce mcp --offline` installs nothing. Without npm, or without its registry, the command
  refuses and says why.

The folder is owner-only and installed whole or not at all. The command refuses to load from it if
another user owns it, if it is not owner-only any more, or if anyone else can write a folder above
it. Older versions' folders are removed, except the newest of them; a newer version's is never
touched. npm reaches the registry your npm configuration names, a mirror or a proxy included.

### Exit codes

A mistyped command exits 2. A program that does not compile, a cook that reverts, a rejected
settle, an outdated skills install and a transaction on a preview chain exit 1.
