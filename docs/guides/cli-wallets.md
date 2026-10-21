# Wallets and signing

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Run a program](cli-run.md)

> To send anything, someone has to sign it with a key. A wallet is a key with a lock on it: `sauce`
> keeps your keys in a folder on your computer, each locked with a password, and `--wallet <name>`
> unlocks one to sign. You can put a spending limit on a wallet. And when your key lives somewhere
> else, such as a hardware wallet or a company vault, `sauce` hands you the transaction unsigned and
> sends it once it is signed.

This page is for anyone about to send a transaction with the `sauce` command. It needs the command
installed ([Install](cli.md#install)). Make a wallet first: every command that sends needs one, or
another signer from the end of this page.

The wallets `sauce` keeps are quick to set up, and right for trying things out with small amounts.
For real money, a wallet that keeps its key to itself is safer: with a coding agent, let your
wallet's own MCP server sign ([Sign with your wallet's MCP server](wallet-mcp.md)).

## Make a wallet

```sh
sauce wallet new me                 # an Ethereum-style wallet, for Ethereum and Base
sauce wallet new me-solana --solana # a Solana wallet
sauce wallet list                   # every wallet, with its address
sauce wallet address me             # one wallet's address
```

`new` asks for a password twice (8 characters or more), then prints the wallet's name, kind,
address and file. The key is stored encrypted in `~/.sauce/wallets`, and `list` and `address` need
no password. A name is up to 64 lowercase letters, digits, `-` and `_`. A wallet is never
overwritten: pick another name for a second one.

Send the wallet's address a little of the chain's coin (ETH on Ethereum and Base, SOL on Solana)
before its first run: it pays the gas and the Kitchen's fee.

### Import a key you have

```sh
sauce wallet import me key.txt                          # a private key in hex, or a keystore file
sauce wallet import me-solana ~/.config/solana/id.json  # a Solana keypair file
```

The key is read from a file, or from stdin with `-`, never from the command line. A keystore is
opened with its password, which the wallet then keeps.

### Show a key again

`sauce wallet export me` shows the key on the terminal itself, never on stdout, after you type the
wallet's name. It refuses without a terminal.

### Know where wallets are kept

Each wallet is one file, `<name>.json`, created readable only by you in a directory only you can
open. `--wallets <dir>` keeps them in another directory. An Ethereum-style wallet's file is a
standard encrypted keystore, exactly as geth and `cast wallet` write one, so `--keystore <file>`
and `cast wallet` read it too. A Solana wallet's file is the same envelope around the keypair. Each
file names its address in the clear, which is why `list` and `address` need no password.

## Sign with it

Every command that sends takes `--wallet <name>`, and asks for the password when it needs it:

```sh
sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
```

That is `run`, `pot --deploy`, `intent publish`, `intent fill --send` and the intent steps after
it. An Ethereum-style wallet signs on Ethereum and Base, a Solana wallet on Solana.

`sauce simulate` and `sauce pot` take `--wallet` only to know whose Pot (your own account on the
chain, which holds what your programs spend), and ask no password. The one exception is
`simulate --fund`, which asks for it to sign the token pulls it simulates. It still sends nothing.

**These are hot wallets.** Whoever holds a wallet's file and its password holds the key. Keep
small balances in them, and give each one a spending limit.

## Put a spending limit on a wallet

A **policy** is a file named `<name>.policy.json`, beside the wallet in `~/.sauce/wallets`, that
limits what the wallet sends. Every field is optional:

```json
{
  "chains": ["base", "ethereum"],
  "to": ["<address>"],
  "native": { "perTransaction": "0.01", "perDay": "0.05" },
  "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } }
}
```

- `chains`: the only chains it sends on.
- `to`: the only addresses a transaction may go to.
- `native`: how much of the chain's coin may leave, per transaction and per day.
- `tokens`: how much of each token may leave. Amounts are whole tokens: `"100"` is 100 USDC.

A send that breaks a limit is refused before anything is signed, and the refusal names the limit:

```text
sauce run: refused by the policy of wallet me (…/me.policy.json): tokens.USDC.perTransaction is 100 USDC, and this transaction sends 250 USDC
```

With no policy file, sends work, and each says that no limits are set. Make the file readable and
writable only by you (`chmod 600`): a policy file that others can write is refused, because they
could loosen it.

### Know what each limit counts

- Amounts are strings in whole tokens (`"1.5"`), or in base units ending in `n` (`"1500000n"`).
- `to` on Solana names the programs a transaction's instructions call. Deploying the wallet's own
  Pot counts as a transaction to that Pot, so a policy that lets the wallet cook on its Pot lets a
  command create the Pot first.
- `native` counts the chain's coin leaving the wallet or the Pot the transaction cooks on. On
  Solana the fee and any rent are included.
- `tokens` are named by registry symbol or by address (an ERC-20, a Solana mint). They count what
  leaves the wallet or its Pot. An approval above what the limit leaves room for is refused, an
  approval of Permit2 aside, which moves nothing without a later signature. A token the policy does
  not name is not limited.
- `perDay` is the last 24 hours, every chain together, counted from `<name>.ledger.jsonl` beside the
  wallet.

A field the policy does not know is an error, so a typo never silently lifts a limit.

### Know how a send is measured

What a transaction moves is measured, not read from its calldata. An EVM transaction is simulated
with `eth_simulateV1` (a node method that runs it and returns its logs), and its token and native
transfers out of the wallet and its Pot are counted. A Solana transaction is simulated with the
accounts it writes reported. A limit that cannot be measured on the endpoint (one without
`eth_simulateV1`, for one) refuses the send. Every wallet send also holds to the
[supported chains](cli.md#supported-and-preview-chains).

## Passwords without a prompt

A script, a CI job or a coding agent cannot type a password. Name where it comes from instead, with
one of these:

- `--password-env <NAME>`: the environment variable `NAME`, and no other.
- `--password-file <path>`: the file's text. A file anyone but you can read is refused:
  `chmod 600` it.
- `--password-command "<command>"`: what a command prints, such as a secret manager's
  (`pass show sauce`, `op read op://…`).

```sh
sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD
sauce run pay.sauce.ts --chain base \
  --wallet agent --password-env SAUCE_WALLET_PASSWORD --args <recipient> 1000000
```

Give one source only. With none, the password is asked for at the terminal without echo. There is
no `--password <value>`: a value on the command line lands in your shell history and the process
list.

`--password-file` and `--password-command` drop one trailing newline. `--password-command` runs
with no stdin, and if it fails, the error gives its exit status and never its output.
`--password-env` is the command's one read of the environment, and only of the variable you name.
No command prints a key or a password: everything a command writes passes through a filter that
removes any secret it was given, error messages included.

## Sign somewhere else: `sauce tx` and `sauce send`

When the key never touches this machine, split the run in two. `sauce tx` prints the transaction
unsigned; your signer signs it; `sauce send` sends it and reports what it did:

```sh
sauce tx pay.sauce.ts --chain base --owner 0xYou --args <recipient> 1000000
# … sign what it printed with your wallet, hardware wallet or KMS …
sauce send 0x02f8…signed
```

The signer is always the Pot's owner, `--owner`. Simulate the same program and arguments first, so
you know what the transaction you sign does ([Try it](cli-run.md#try-it-sauce-simulate)).

### Read the unsigned transaction

`sauce tx` prints the transaction for the owner to sign:

```json
{ "chainId": 8453, "to": "0x8a…", "data": "0x…", "value": "0x3e8", "sendCalls": { … } }
```

`to` is the Pot and `data` the cook, the call that runs the program on it. The value is in wei,
written in hex as wallets read it: `0x3e8` is 1000. It defaults to the Kitchen's fee, read from the
chain; `--value` sets it. The transaction is exactly what a wallet's MCP server takes, and
`sendCalls` is the same transactions as one batch, for a wallet that sends a batch
([Sign with your wallet's MCP server](wallet-mcp.md)).

### Sign a new Pot's creation and its first cook

When the chain shows the Pot has no code yet, `sauce tx` prints a plan of two instead: the Pot's
creation, marked `deploysPot`, then the cook. Sign and send them in that order. Any account may
send the first; only the owner can send the second.

```json
{
  "chainId": 8453,
  "pot": "0x8a…",
  "transactions": [
    {
      "what": "Kitchen.deployPot(0xYou, 0x00…00): deploys the Pot, which has no code yet",
      "deploysPot": "0x8a…",
      "chainId": 8453,
      "to": "0x…",
      "data": "0x…",
      "value": "0x0",
      "gas": "0x32e9b"
    },
    {
      "what": "cook on Pot 0x8a…",
      "chainId": 8453,
      "to": "0x8a…",
      "data": "0x…",
      "value": "0x3e8",
      "gas": "0x28f12"
    }
  ],
  "sendCalls": { "chain": "base", "calls": [ … ] }
}
```

Sign each with the `gas` the plan gives it. The two are simulated together, so the cook's gas is
estimated as if the creation had landed, with 30% room. A signer's own estimate of the cook, taken
while the Pot has no code, is far too low.

What must be true for the plan to land goes to stderr: the Pot funded, and sent from its owner. A
cook that would revert, as a cook on a Pot not funded yet does, comes with no `gas` and a note
saying why: fund the Pot (its address takes tokens before it is deployed) and build it again. A Pot
named with `--pot` and no code is not planned, because its owner and salt are not known: the note
names `sauce pot --deploy`. On Solana a cook may need several transactions, and `sauce tx` prints
the first step of a plan ([Solana](cli-solana.md#a-cook-in-several-transactions)).

### Fund the Pot in the same batch

`--fund USDC:100` puts the tokens the program spends into the plan too: a transfer from you into the
Pot, right before the cook. A wallet that sends a batch then creates the Pot, fills it and runs the
program in one go, or does nothing.

### Send what you signed

```sh
sauce send 0x02f8…deploy 0x02f8…cook --rpc-url <url>
sauce send AQAB… --chain solana
```

Each operand is one signed transaction: on an EVM chain the raw `0x…` hex a signer returns, on
Solana the base64 wire transaction. `-` reads them from stdin. They go out in the order given:

- Each is simulated as it was signed first. One that would fail is not sent: the reason is printed,
  the command exits 1, and nothing after it goes out.
- Each lands before the next is simulated, so the cook after its Pot's creation runs on the Pot.
- A cook signed with less gas than its simulation uses is refused, unsent.
- A transaction already on chain is read back, not sent again. One the chain had, pending, then
  lost is reported as gone, to sign anew.
- A Solana transaction lands within about a minute of being built, or never: one whose blockhash
  has expired is refused, to build and sign again.

For each, it prints the hash (a Solana signature), the status and what it cost, the explorer and
trace pages, and for a cook what moved and what it left in the Pot, as `sauce run` does. It takes
no key.

### Print `cast send` lines

`--format cast` prints the same transactions as `cast send` lines instead, for
[Foundry](https://getfoundry.sh/cast/overview) users. The line leaves the endpoint and the signer
as `<RPC_URL>` and `<PRIVATE_KEY>` placeholders: the command never fills in either.

## Other signers

Besides `--wallet`, a command signs with:

- `--keystore <path>`: a JSON keystore file, as `cast wallet` and geth write. It takes the same
  password sources.
- `--private-key <hex>`: works, with a warning, because it lands in your shell history.
- `--keypair <path>`, on Solana: a keypair file, the JSON array of 64 bytes `solana-keygen` writes.

Give one signer per command. The signer is always the Pot's owner. On Solana with `--via engine`,
which uses no Pot, the signer is the program's authority instead ([Solana](cli-solana.md)).

## Next

- Run a program with the wallet you made: [Run a program](cli-run.md).
- Let a coding agent sign through your wallet's own MCP server:
  [Sign with your wallet's MCP server](wallet-mcp.md).
- Why a policy and a simulation protect you: [Safety](../concepts/safety.md).
- Before you run with real funds: the [production checklist](production-checklist.md).
