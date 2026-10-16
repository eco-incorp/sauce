# What a local server keeps

**How-to guide** · [Documentation](../README.md) · [The MCP server](mcp.md) · [Tools](mcp-tools.md)

> When the server runs on your own computer, it can keep things for your agent, like a desk drawer:
> wallets to send from, a list of the Pots it made, and the intents it posted. They are the same
> ones the `sauce` command keeps, in the same folders, so you and your agent see the same things.
> A server run for a team over HTTP keeps nothing.

## What it keeps

| What        | Where              | So that                                                         |
| ----------- | ------------------ | --------------------------------------------------------------- |
| Wallets     | `~/.sauce/wallets` | the agent can sign and send, under each wallet's spending limit |
| The Pots    | `~/.sauce/pots`    | `sauce_pot_list` lists the Pots its sends made                  |
| The intents | `~/.sauce/intents` | every intent tool can name an intent by its hash                |

`--no-stores` keeps none of them: the server then writes nothing.

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
   spending limit, signs it and sends it.

These are hot wallets, for experiments and development: keep small balances in them, and give each
a [spending limit](cli-wallets.md#put-a-spending-limit-on-a-wallet). For real money, have your
wallet's own MCP server sign instead ([Sign with your wallet's MCP server](wallet-mcp.md)).

### Wallets in detail

Over stdio, the server sends what it builds from wallets of its own: the `sauce` command's,
[`sauce wallet`](cli-wallets.md)'s, in `~/.sauce/wallets`. The one-line install serves them,
with nothing more to configure. `--wallets <dir>` serves another directory, and `--no-wallets`
serves none: then nothing signs, and the wallet tools are not there. The wallet directory is one
of the command's stores the local server keeps, so `--no-stores` leaves it out too.

Listing the wallets needs no password: each wallet's file names its address in the clear. Creating
a wallet, importing one and sending from one need the wallets **enabled** by the source of their
password. The password itself is never a tool's input and never in a result, so it stays out of
the model's context. A source enables them in one of two ways.

**The agent enables them**, with `sauce_wallet_enable`, once per server. It names where the
password comes from, never the password, in one of four ways:

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
same wallets again. A shell command is never a source the agent names: that is the operator's
alone, below.

The password stays in the server's memory, never on disk, for the life of the process. Calling
`sauce_wallet_enable` again replaces the source, so a wrong first choice needs no restart. `dir`
names another wallet directory, unless the server was started with one.

**The operator enables them** when the server starts, with the source of their password, as
`sauce wallet` takes one: `--password-env <NAME>`, `--password-file <path>` or
`--password-command "<command>"`. There is no prompt: over stdio, stdin is the protocol's. The
server reads the password once, before it serves anything, so a source that does not work stops
it at start. That source is the operator's: `sauce_wallet_enable` does not replace it. The
agent's password lives in its `.env` or its secret store, and the client's configuration passes it
to the server in the entry's `env` block, by reference, never by value:

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

The wallet tools, besides every other tool:

- `sauce_wallet_enable` enables them, as above.
- `sauce_wallet_list` returns the wallet directory, whether the wallets are `enabled` and by which
  `source`, and each wallet with its kind, address and policy. `sauce_wallet_address` `{ name }`
  returns one. Neither needs a password.
- `sauce_wallet_create` `{ name, kind }` makes a wallet (`kind` `evm`, the default, or `solana`),
  encrypted under the wallets' password (8 characters at least, as for `sauce wallet new`), and
  returns its address. Its key never leaves the wallet's file except to sign, in the server's
  process.
- `sauce_wallet_import` `{ name, path, kind }` makes a wallet of the key in a file on the
  machine, as `sauce wallet import` does: a keystore (geth's, `cast`'s or another Sauce
  wallet's, which must open with the wallets' password and keeps it), a Solana keypair file, or an
  EVM private key in hex. The tool sees only the path. The file must be one only its owner can
  read, and is left as it is.
- `sauce_wallet_send` `{ wallet, transaction, chain?, rpcUrl? }` sends. `transaction` is the
  whole result of `sauce_tx`, `sauce_pot`, `sauce_actions` (with an owner), `sauce_intent_publish`
  or any `sauce_intent_*` step, or a transaction, or a list of them. It simulates them first: on an
  EVM chain all together in one `eth_simulateV1` block from the wallet, on Solana each as signed.
  If any would revert, it refuses and sends nothing. It holds them to the wallet's
  [policy](cli-wallets.md#put-a-spending-limit-on-a-wallet) and refuses, naming the limit, what the policy does not allow.
  Then it sends each in order, through the same path `sauce run` uses, and stops at the first that
  does not succeed. It returns each one's `hash` (on Solana, its signature) and `status`, with
  `explorer` and `trace` beside it: the chain's explorer page and the transaction's trace on
  BlockSec's Phalcon explorer (calls, balance changes and fund flow), links for the user to open.
  For a cook on an EVM chain it adds what its receipt shows: `moves`, in order and by role,
  `leftInPot`, and `summary`, the lines `sauce run` prints.

Before the wallets are enabled, creating, importing and sending are refused, the refusal naming
`sauce_wallet_enable` and its four sources. So an agent goes: `sauce_wallet_enable` (asking the
user where the password should come from), `sauce_wallet_create`, fund the address, build with the
wallet's address as `owner` or `from` (`sauce_pot`, `sauce_tx`, `sauce_intent_fill`, …), simulate
with `sauce_simulate`, and pass the building tool's result to `sauce_wallet_send`. Each tool that
builds a transaction says, on a server with wallets, that `sauce_wallet_send` sends it. There is no
export tool: `sauce wallet export` shows a key only at a terminal.

Wallet sends hold to the [supported chains](mcp-tools.md#supported-and-preview-chains) too. Over HTTP there are no wallets:
`--wallets` and the password flags are refused, and neither the wallet tools nor
`sauce_wallet_enable` is registered.

## The Pots and the intents

Over stdio the server is the `sauce` command for an agent that has no shell, so it keeps what the
command keeps, where the command keeps it, with no flag: the Pot store, `~/.sauce/pots`
([The Pots you made](cli-run.md#the-pots-you-made-sauce-pot-list)), and the intent store,
`~/.sauce/intents` ([Follow it](cli-intents.md#follow-it)). Every Pot a
transaction it sends deploys (a deployment through `sauce_send` or `sauce_wallet_send`, or a cook
whose program deploys one) is recorded once the chain shows it, exactly as the command records it,
and the result's `notes` say so. `sauce_pot_list` lists the store, and `sauce_pot_import` records a
Pot deployed some other way. Both read and write the same files as `sauce pot list` and
`sauce pot import`, so the command and the server see each other's Pots.

Every intent a transaction it sends publishes is stored the same way, and what one does to an
intent — `filled`, `proving`, `claimed`, `refunded`, `cancelled` — is recorded from the Portal's
own events, for an intent the store holds or one a call named by its `record` or `txHash`.
`sauce_intent_list` and `sauce_intent_show` are `sauce intent list` and `show`,
`sauce_intent_import` stores what it reads, and every intent tool takes `intentHash`, an intent the
store holds, as the command takes a hash.

`--pots <dir>` and `--store <dir>` keep the stores in other directories. `--no-stores` keeps
nothing: then the server writes nothing, has none of those tools and no `intentHash`, and serves
no [wallet](#wallets) either. Either way, each transaction in a send's result carries `pots`,
the record of each Pot it deployed, for the client to keep. Over HTTP the server keeps nothing, and
`--pots`, `--store` and `--no-stores` are refused there.
