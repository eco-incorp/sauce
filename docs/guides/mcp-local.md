# What a local server keeps

**How-to guide** · [Documentation](../README.md) · [The MCP server](mcp.md) · [Tools](mcp-tools.md)

> When the server runs on your own computer, it can keep things for your agent, like a desk drawer:
> wallets to send from, and a list of the Pots it made. They are the same ones the `sauce` command
> keeps, in the same folders, so you and your agent see the same things. A server run for a team
> over HTTP keeps nothing.

This page is for you once your agent has the [MCP server](mcp.md) and can simulate a program
([Your first agent session](agent-quick-start.md)). A **Pot** is the account that runs your
programs ([glossary](../concepts/glossary.md)). Sending from a wallet spends real funds.

## What it keeps

| What     | Where              | So that                                                 |
| -------- | ------------------ | ------------------------------------------------------- |
| Wallets  | `~/.sauce/wallets` | the agent can sign and send, under each wallet's policy |
| The Pots | `~/.sauce/pots`    | `sauce_pot_list` lists the Pots its sends made          |

A wallet's **policy** is a spending limit you set: a file beside the wallet that caps what it may
send, per transaction and per day ([Put a spending limit on a wallet](cli-wallets.md#put-a-spending-limit-on-a-wallet)).

## Wallets

The server serves the `sauce` command's wallets with no setup. Listing them needs no password.
Sending from one needs the password, and the agent never sees it: you, or the agent, name where it
comes from, and the server reads it there.

The usual flow:

1. `sauce_wallet_enable`, once per server, naming the password's source. The agent asks you where
   the password should come from.
2. `sauce_wallet_create` makes a wallet and returns its address. Send it some funds.
3. Build with the wallet's address as `owner`: `sauce_simulate`, then `sauce_tx`.
4. `sauce_wallet_send` takes `sauce_tx`'s result, simulates it, checks it against the wallet's
   policy, signs it and sends it.

These are hot wallets, for experiments and development: keep small balances in them, and give each
a policy. For real money, have your wallet's own MCP server sign instead
([Sign with your wallet's MCP server](wallet-mcp.md)).

Over stdio, the server's wallets are the `sauce` command's, the ones [`sauce wallet`](cli-wallets.md)
makes in `~/.sauce/wallets`. `--wallets <dir>` serves another directory, and `--no-wallets` serves
none: then nothing signs, and the wallet tools are not there. Over HTTP there are no wallets:
`--wallets` and the password flags are refused, and no wallet tool is registered.

### Let the agent enable the wallets

Creating a wallet, importing one and sending from one need the wallets **enabled** by the source of
their password. The password itself is never a tool's input and never in a result, so it stays out
of the model's context.

The agent enables them with `sauce_wallet_enable`, once per server. It names where the password
comes from, never the password, in one of four ways:

| Input                                                   | The password                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ env: "SAUCE_WALLET_PASSWORD" }`                      | A variable of the server's environment, which the client's configuration passes (below)                                                     |
| `{ file: "~/.sauce/agent.password" }`                   | A file only its owner can read (`chmod 600`), its first line                                                                                |
| `{ dotenv: ".env", variable: "SAUCE_WALLET_PASSWORD" }` | One entry of a `.env` file only its owner can read; `variable` is `SAUCE_WALLET_PASSWORD` when left out                                     |
| `{ generate: true }`                                    | A new random password the server writes to a new file beside the wallet directory, `~/.sauce/wallets.password`, readable by its owner alone |

A file it names must be a regular file that no one else can read or write: one that others can is
refused, with the `chmod 600` that fixes it. `generate` takes a path for the new file instead of
`true`, in a directory that exists and outside the wallet directory; it never writes over a file,
and says so when the path is inside a git work tree. A generated password sits in that file in the
clear, so whoever can read it and a wallet's file holds that wallet's key: keep it out of
repositories, backups and synced folders. After a restart, `{ file: "<that path>" }` enables the
same wallets again. A shell command is never a source the agent names: only you can give one,
when you start the server.

The password stays in the server's memory, never on disk, for the life of the process. Calling
`sauce_wallet_enable` again replaces the source, so a wrong first choice needs no restart. `dir`
names another wallet directory, unless the server was started with one.

### Enable the wallets when the server starts

You can instead give the server the password's source in its configuration, as `sauce wallet`
takes one: `--password-env <NAME>`, `--password-file <path>` or `--password-command "<command>"`.
There is no prompt: over stdio, stdin is the protocol's. The server reads the password once, before
it serves anything, so a source that does not work stops it at start. `sauce_wallet_enable` does
not replace a source given this way. [Passwords without a prompt](cli-wallets.md#passwords-without-a-prompt)
says how each source is read.

Keep the agent's password in its `.env` or its secret store, and have the client's configuration
pass it to the server in the entry's `env` block, by reference, never by value:

```json
{
  "mcpServers": {
    "sauce": {
      "type": "stdio",
      "command": "sauce",
      "args": ["mcp", "--password-env", "SAUCE_WALLET_PASSWORD"],
      "env": { "SAUCE_WALLET_PASSWORD": "${SAUCE_WALLET_PASSWORD}" }
    }
  }
}
```

Each client fills that reference its own way: Claude Code expands `${SAUCE_WALLET_PASSWORD}` from
the environment it runs in, and VS Code also reads an `envFile` (the project's `.env`). Keep the
`.env` out of git. The same `env` block, without the flag, gives the agent a variable to name to
`sauce_wallet_enable`.

Before the wallets are enabled, creating, importing and sending are refused, the refusal naming
`sauce_wallet_enable` and its four sources.

### Make, import and list wallets

- `sauce_wallet_list` returns the wallet directory, whether the wallets are `enabled` and by which
  `source`, and each wallet with its kind, address and policy. `sauce_wallet_address` `{ name }`
  returns one. Neither needs a password: each wallet's file names its address in the clear.
- `sauce_wallet_create` `{ name, kind }` makes a wallet (`kind` `evm`, the default, or `solana`),
  encrypted under the wallets' password (8 characters at least, as for `sauce wallet new`), and
  returns its address. Its key never leaves the wallet's file except to sign, in the server's
  process.
- `sauce_wallet_import` `{ name, path, kind }` makes a wallet of the key in a file on the
  machine, as `sauce wallet import` does: a keystore (geth's, `cast`'s or another Sauce
  wallet's, which must open with the wallets' password and keeps it), a Solana keypair file, or an
  EVM private key in hex. The tool sees only the path. The file must be one only its owner can
  read, and is left as it is.

There is no export tool: `sauce wallet export` shows a key only at a terminal.

### Send from a wallet

`sauce_wallet_send` `{ wallet, transaction, chain?, rpcUrl? }` sends. `transaction` is the whole
result of `sauce_tx`, `sauce_pot` or `sauce_actions` (with an owner), or a transaction, or a list
of them. Each tool that builds a transaction says, on a server with wallets, that
`sauce_wallet_send` sends it.

1. It simulates them first. On an EVM chain it runs them all together in one simulated block, from
   the wallet; on Solana, each as signed. If any would revert, it refuses and sends nothing.
2. It holds them to the wallet's policy, and refuses, naming the limit, what the policy does not
   allow.
3. It sends each in order, through the same path `sauce run` uses, and stops at the first that does
   not succeed.

It returns each one's `hash` (on Solana, its signature) and `status`, with `explorer` and `trace`
beside it: the chain's explorer page and the transaction's trace on BlockSec's Phalcon explorer
(calls, balance changes and fund flow), links for the user to open. For a cook on an EVM chain it
adds what its receipt shows: `moves`, in order and by role, `leftInPot`, and `summary`, the lines
`sauce run` prints.

Wallet sends hold to the [supported chains](mcp-tools.md#supported-and-preview-chains) too.

## The Pots

Over stdio the server is the `sauce` command for an agent that has no shell, so it keeps what the
command keeps, where the command keeps it, with no flag.

The Pot store is `~/.sauce/pots`
([The Pots you made](cli-run.md#the-pots-you-made-sauce-pot-list)). Every Pot a transaction the
server sends deploys is recorded once the chain shows it, exactly as the command records it, and
the result's `notes` say so. That covers a deployment through `sauce_send` or `sauce_wallet_send`,
and a cook whose program deploys one. `sauce_pot_list` lists the store, and `sauce_pot_import`
records a Pot deployed some other way. Both read and write the same files as `sauce pot list` and
`sauce pot import`, so the command and the server see each other's Pots.

## Keep the stores elsewhere, or keep nothing

`--pots <dir>` keeps the Pot store in another directory, as `--wallets <dir>` serves other wallets.
`--no-stores` keeps nothing: then the server writes nothing, has neither `sauce_pot_list` nor
`sauce_pot_import`, and serves no wallet either. Either way, each transaction in a send's result
carries `pots`, the record of each Pot it deployed, for the client to keep. Over HTTP the server
keeps nothing, and `--pots` and `--no-stores` are refused there.

## Next

- Sign real money with a wallet that keeps its key: [Sign with your wallet's MCP server](wallet-mcp.md).
- Run one server for a whole team: [Self-hosting over HTTP](mcp-http.md).
- Every tool and its inputs: [The MCP server's tools](mcp-tools.md).
