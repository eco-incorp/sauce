# Wallets and signing

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Run a program](cli-run.md)

> To send anything, someone has to sign it with a key. A wallet is a key with a lock on it: `sauce`
> keeps your keys in a folder on your computer, each locked with a password, and `--wallet <name>`
> unlocks one to sign. You can put a spending limit on a wallet. And when your key lives somewhere
> else, such as a hardware wallet or a company vault, `sauce` hands you the transaction unsigned and
> sends it once it is signed.

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

`new` asks for a password twice (8 characters or more), then prints the wallet's address. The key is
stored encrypted in `~/.sauce/wallets`, and `list` and `address` need no password.

Already have a key? Keep it as a wallet:

```sh
sauce wallet import me key.txt                          # a private key in hex, or a keystore file
sauce wallet import me-solana ~/.config/solana/id.json  # a Solana keypair file
```

The key is read from a file, or from stdin with `-`, never from the command line. `sauce wallet
export me` shows a key again, on the terminal only, after you type the wallet's name.

## Sign with it

Every command that sends takes `--wallet <name>`, and asks for the password when it needs it:

```sh
sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
```

That is `run`, `pot --deploy`, `simulate --fund`, `intent publish`, `intent fill --send` and the
intent steps after it. An Ethereum-style wallet signs on Ethereum and Base, a Solana wallet on
Solana. A command that only needs to know whose Pot, such as `sauce simulate` and `sauce pot`, takes
`--wallet` too, and asks no password.

**These are hot wallets.** Whoever holds a wallet's file and its password holds the key. Keep
small balances in them, and give each one a spending limit.

## Put a spending limit on a wallet

A file named `<name>.policy.json`, beside the wallet in `~/.sauce/wallets`, limits what the wallet
sends. Every field is optional:

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

With no policy file, sends work, and each says that no limits are set.

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

There is no `--password <value>`: a value on the command line lands in your shell history and the
process list.

## Sign somewhere else: `sauce tx` and `sauce send`

When the key never touches this machine, split the run in two. `sauce tx` prints the transaction
unsigned; your signer signs it; `sauce send` sends it and reports what it did:

```sh
sauce tx pay.sauce.ts --chain base --owner 0xYou --args <recipient> 1000000
# … sign what it printed with your wallet, hardware wallet or KMS …
sauce send 0x02f8…signed
```

`sauce tx` prints the transaction for the owner to sign:

```json
{ "chainId": 8453, "to": "0x8a…", "data": "0x…", "value": "0x3e8", "sendCalls": { … } }
```

The value is in wei, written in hex as wallets read it: `0x3e8` is 1000. The transaction is exactly
what a wallet's MCP server takes, and `sendCalls` is the same as one batch
([Sign with your wallet's MCP server](wallet-mcp.md)).

When the Pot does not exist yet, it prints a plan of two instead, the Pot's creation then the cook,
each with the `gas` to sign it with. Sign and send them in that order.

`--fund USDC:100` puts the tokens the program spends into the plan too: a transfer from you into the
Pot, right before the cook. A wallet that sends a batch then creates the Pot, fills it and runs the
program in one go.

`sauce send` takes the signed transactions, in order. It checks each would succeed before sending
it, waits for each to land, and prints what it did, as `sauce run` does. It takes no key.

## Other signers

Besides `--wallet`, a command signs with:

- `--keystore <path>`: a JSON keystore file, as `cast wallet` and geth write. It takes the same
  password sources.
- `--private-key <hex>`: works, with a warning, because it lands in your shell history.
- `--keypair <path>`, on Solana: a keypair file, the JSON array of 64 bytes `solana-keygen` writes.

The signer is always the Pot's owner.

## Details

### Wallet files

| Verb      | Does                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new`     | Generates a key and stores it as `<name>.json`, created `0600` in a directory created `0700`, written once and never overwritten. `--solana` makes a Solana keypair. The password is 8 characters or more |
| `list`    | Each wallet's name, kind (`evm` or `solana`), address, and whether a policy limits it                                                                                                                     |
| `address` | One wallet's address                                                                                                                                                                                      |
| `import`  | A key you have, read from a file or stdin (`-`), never from the command line: an EVM private key, a keystore (opened with the password, which the wallet keeps), or a Solana keypair file                 |
| `export`  | The key, shown on the terminal itself (never stdout) once you type the wallet's name. It refuses without a terminal, and the MCP server has no such tool                                                  |

`--wallets <dir>` keeps them in another directory. An EVM wallet's file is a Web3 Secret Storage v3
keystore (scrypt, AES-128-CTR, a keccak-256 MAC), exactly as geth and `cast wallet` write one, so
`--keystore <file>` and `cast wallet` read it too. A Solana wallet's file is the same envelope around
the keypair's 64 bytes, marked `"kind": "solana"`. Each file names its address in the clear, so
`list` and `address` need no password.

### Passwords in detail

A wallet's or a keystore's password comes from the one source you name, or else it is asked for at
the terminal without echo. `--password-file` and `--password-command` drop one trailing newline.
`--password-command` runs with no stdin, and if it fails, the error gives its exit status and never
its output. `--password-env` is the command's one read of the environment, and only of the variable
you name. Keys are read from the paths and wallets named only, never from the config file, and no
command prints one or a password: everything a command writes passes through a filter that removes
any secret it was given, error messages included.

The `--keystore` format is Web3 Secret Storage v3, with scrypt or PBKDF2. On Solana with
`--via engine`, which uses no Pot, the signer is the program's authority instead of a Pot's owner.

### Policies in detail

Every amount in a policy is a string in whole tokens (`"1.5"`), or in base units ending in `n`, as
`--fund` takes them.

- `chains` names the only chains it sends on, and `to` the only addresses a transaction goes to (on
  Solana, the programs its instructions call). Deploying the wallet's own Pot (the released
  Kitchen's `deployPot` of that wallet, with no value) counts as a transaction to the Pot, not to
  the Kitchen: a policy that lets the wallet cook on its Pot lets a command deploy that Pot first,
  and one that does not refuses the deployment, naming the Pot to add.
- `native` is the chain's native coin leaving the wallet or the Pot the transaction cooks on. On
  Solana the fee and any rent are included.
- `tokens` are named by registry symbol or by address (an ERC-20, a Solana mint). They count what
  leaves the wallet or its Pot, and an approval above what the limit leaves room for is refused (an
  approval of Permit2 aside, which moves nothing without a signature in a later cook). A token the
  policy does not name is not limited.
- `perDay` is the last 24 hours, every chain together, counted from `<name>.ledger.jsonl` beside the
  wallet.

What a transaction moves is measured, not read from its calldata. An EVM transaction is simulated
with `eth_simulateV1`, and its token and native transfers out of the wallet and its Pot are
counted. A Solana transaction is simulated with the accounts it writes reported. A limit that cannot
be measured on the endpoint (no `eth_simulateV1`, for one) refuses the send. A policy file that
others can write is refused: they could loosen it. Every wallet send also holds to the
[supported chains](cli.md#supported-and-preview-chains).

### `sauce tx` in detail

The value is `--value`, or else the Kitchen's fee, read from the chain, which also checks the Pot.
When the chain shows the Pot has no code yet, it prints the plan instead: the Pot's deployment
first, marked `deploysPot`, then the cook, to send in that order (any account may send the first;
only the owner the second). Each comes with `gas`, the limit to sign it with: the two are simulated
together, so the cook's is estimated as if the deployment had landed, with 30% room. A signer's own
estimate of the cook, taken while the Pot has no code, prices a call to an empty address and is far
too low. Where the endpoint does not report the deployment's gas apart, the deployment carries
none, as a signer's own estimate of it is right (the Kitchen it calls has code). The plan:

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

What must be true for it to land (the Pot funded, sent from its owner) goes to stderr. A cook that
would revert after the deployment, as a cook on a Pot not funded yet does, comes with no `gas` and a
note saying why: fund the Pot (its address takes tokens before it is deployed) and build it again.
A Pot named with `--pot` and no code is not planned (its owner and salt are not known): the note
names `sauce pot --deploy`. On Solana a cook may need several transactions; `sauce tx` then prints
the first step of a plan ([Solana](cli-solana.md#a-cook-in-several-transactions)).

`--format cast` prints the same transactions as `cast send` lines instead, for
[Foundry](https://getfoundry.sh/cast/overview) users. The line leaves the endpoint and the signer
as `<RPC_URL>` and `<PRIVATE_KEY>` placeholders: the command never fills in either.

### `sauce send` in detail

```sh
sauce send 0x02f8…deploy 0x02f8…cook --rpc-url <url>
sauce send AQAB… --chain solana
```

Each operand is one signed transaction: on an EVM chain the raw `0x…` hex a signer returns (its
chain and sender are read from it), on Solana the base64 wire transaction (every signature is
checked against its message); `-` reads them from stdin. They go out in the order given, each
simulated as it was signed first (an `eth_call` from its sender with its gas limit held to what that
used, or a Solana simulation that checks the signatures), and one that would fail is not sent: the
reason is printed, exit 1, and nothing after it goes out. Each lands before the next is simulated,
so the cook after its Pot's deployment runs on the Pot. Sign each with the `gas` the plan gives it:
a cook signed with less than its simulation uses is refused, unsent. A transaction already on chain
is read back, not sent again; one the chain had, pending, then lost (dropped, or reorged out) is
reported as gone rather than waited for, to sign anew. A Solana transaction missing a signature
(its fee payer's, or any its message names) is refused by name, before any request.

For each, it prints the hash (a Solana signature), the status and what it cost, the explorer and
trace pages, the decoded reason a failure gives, and for a cook what moved and what it left in the
Pot; on Solana, what `main` returned. A Solana transaction lands within about a minute of being
built, or never: one whose blockhash has expired is refused, to build and sign again.
