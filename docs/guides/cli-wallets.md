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
sauce wallet new me                 # an Ethereum-style wallet, for Ethereum, Base and Arc
sauce wallet new me-solana --solana # a Solana wallet
sauce wallet list                   # every wallet, with its address
sauce wallet address me             # one wallet's address
```

`new` asks for a password twice (8 characters or more), then prints the wallet's name, kind,
address and file. The key is stored encrypted in `~/.sauce/wallets`, and `list` and `address` need
no password. A name is up to 64 lowercase letters, digits, `-` and `_`. A wallet is never
overwritten: pick another name for a second one.

Send the wallet's address a little of the chain's coin (ETH on Ethereum and Base, USDC on Arc, SOL
on Solana) before its first run: it pays the gas and the Kitchen's fee.

### Import a key you have

```sh
sauce wallet import me key.txt                          # a private key in hex, or a keystore file
sauce wallet import me-solana ~/.config/solana/id.json  # a Solana keypair file
```

The key is read from a file, or from stdin with `-`, never from the command line. A keystore is
opened with its password, which the wallet then keeps.

### Show a key again

`sauce wallet export me` shows the key on the terminal itself, never on stdout, after you type the
wallet's name. It refuses without a terminal. That keeps the key out of a pipe or a log, not away
from a program: one that runs the command in a pseudo-terminal can type the name and read the key,
and anything that can read the wallet's file and its password has the key anyway.

### Know where wallets are kept

Each wallet is one file, `<name>.json`, created readable only by you in a directory only you can
open. `--wallets <dir>` keeps them in another directory. An Ethereum-style wallet's file is a
standard encrypted keystore, exactly as geth and `cast wallet` write one, so `--keystore <file>`
and `cast wallet` read it too, without its policy. A Solana wallet's file is the same envelope
around the keypair. Each file names its address in the clear, which is why `list` and `address`
need no password.

## Sign with it

Every command that sends takes `--wallet <name>`, and asks for the password when it needs it:

```sh
sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
```

That is `run`, `pot --deploy` and, on Solana, `reclaim`. An Ethereum-style wallet signs on Ethereum
and Base, a Solana wallet on Solana.

`sauce simulate` and `sauce pot` take `--wallet` only to know whose Pot (your own account on the
chain, which holds what your programs spend), and ask no password. The one exception is
`simulate --fund`, which asks for it to sign the token pulls it simulates. It still sends nothing.

**These are hot wallets.** Whoever holds a wallet's file and its password holds the key. Keep
small balances in them, and give each one a spending limit.

## Put a spending limit on a wallet

A **policy** is a file named `<name>.policy.json`, beside the wallet in `~/.sauce/wallets`, that
limits what the wallet sends when it signs through `--wallet` (or the MCP server's wallet tools).
The same file signed with `--keystore`, `cast wallet` or geth applies no policy, so anyone with the
file and its password can ignore it. Every field is optional:

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
  Solana that is every account the wallet controls: the wallet and the Pot, their token accounts
  (wrapped SOL among them), durable nonce accounts whose authority is the wallet, and stake
  accounts whose withdrawer is (a wallet that is only the staker does not control one), netted, so
  wrapping SOL into the wallet's own account and unwrapping it count only the fee. Rent paid into
  the wallet's own token account, or into the Pot a cook creates, stays the wallet's; rent paid into
  an account the wallet does not control (another key's token account, a code buffer, a lookup
  table) counts, as does the fee. A wallet the transaction gives to another program, or makes a
  durable nonce account another key commands, counts all it holds. On Arc, whose native coin is
  also the `USDC` token (one balance), what leaves as either counts against `native` and the
  `USDC` limit both: native USDC sent and a USDC allowance left are held together, and a USDC
  allowance another key keeps counts against `native` as well as the `USDC` limit.
- `tokens` are named by registry symbol or by address (an ERC-20, a Solana mint). They count what
  leaves the wallet or its Pot. A token the policy does not name is not limited.
- An allowance the transaction leaves another key counts as sent, at the whole allowance, per
  transaction and in the day's total, with what the transaction moves of the token: the spender
  needs no later signature. An approval above what a token's limit leaves room for is refused,
  naming it. A revoke, an allowance spent within the transaction (it counts as what it moved), and a
  spender that is the wallet or its Pot (on Solana, a Pot the transaction cooks on) are none. Each
  allowance is its own permission, whoever gives it and on which contract it stands: changing one
  leaves the others as they are, and they add up. Where a limited token's decimals cannot be read,
  an approval of it is refused, as a transfer of it is.
- On an EVM chain, that is the allowance each spender keeps once the transaction is done, read from
  the chain as the transaction leaves it, each in a simulation of its own that runs the
  transaction's calls again on the block the transaction was simulated on, at the same time: an
  ERC-20's, and one granted through Permit2 (its `approve`, or a `permit` the wallet signed), which
  lets the spender take the token wherever the wallet approved Permit2 for it; Permit2's `lockdown`
  clears one. A read counts only where that simulation is the transaction's own execution again:
  the node reports the same block, and every call succeeds with the same logs, return data and gas.
  An allowance that cannot be read so (the endpoint or the token does not answer, the endpoint
  cannot serve the block, or the calls do not run again as they ran) is not measured, and is
  refused where its token is limited. The wallet's approval of Permit2 for a
  limited token is refused: it makes spendable again every Permit2 allowance of that token the
  wallet gave before, which the transaction does not report. Under such a limit, fund with
  `--fund-mode permit`, `allowance` or `transfer`, or approve Permit2 from a wallet without the
  limit. A transaction counts the wallet's Pot as its own only where it is: a Pot the plan deploys
  for the wallet, or one whose owner the chain shows to be the wallet. A cook's calldata sent
  anywhere else is a payment like any other, and a cook on a Pot whose owner the endpoint cannot
  read (the request fails, or the endpoint answers with an error of its own rather than the
  contract's revert) is refused where a native or token limit needs it.
- The rule behind these: an allowance of a limited token (on Arc, of USDC under a `native` limit
  too) to any spender but the wallet or its own Pot counts only where it is measured exactly, and
  is refused where it is not. A refusal a closer measurement could have spared is the price; an
  allowance let through unmeasured is not.
- On an EVM chain an allowance is seen where the transaction reports it (a token's `Approval`, or
  Permit2's own events): a token that sets one with no event is not seen. A Permit2 grant counts at
  its amount, whatever its expiration, and only the registry's Permit2 is read.
- On Solana that is a delegate set or raised (SPL Token `Approve` or `ApproveChecked`) on a token
  account of the wallet or the Pot. An allowance raised and partly spent in the same transaction
  counts what it spent and what is left, also where it ends where it began, whether the wallet's
  own instruction raises it or a call a program makes (a Pot's cook, inside a token `Batch` too).
  A token program's call the endpoint reports so that an approval in it cannot be read refuses
  where a native or token limit applies. Wrapped SOL a delegate outside may move counts against
  `native` too, synced into its amount or not (anyone may sync it), and SOL the wallet sends into
  such an account is not its own once it is there.
- On Solana what the wallet spends as a delegate from a token account it does not own counts as
  sent, against `native` too for wrapped SOL: from a Pot's account with no cook in the transaction,
  and from any other key's.
- On Solana a token account of the wallet or the Pot handed to another owner is a send of all it
  holds, and a transfer out of it in the same transaction counts too; so does an account closed and
  made again at its address for another token. A token account whose close authority goes to another
  key is refused where its token is limited, and a Token-2022 mint whose permanent delegate goes from
  the wallet to another key is refused where that mint is limited. A balance counts in its mint's
  decimals as they were before the transaction, also where the transaction makes the mint again
  with others and leaves the raw amount as it was. Where a limited token's decimals cannot be read, a
  transaction moving it is refused; other limits are not affected.
- A Token-2022 mint's permanent delegate the wallet never held moves tokens with no approval from
  the wallet: no policy limits it.
- The Solana measurement errs toward counting: a spend by the account's owner beside an outside
  allowance that stands may count as if the allowance were raised, and a delegate's spend from
  another key's account counts though nothing of the wallet's left. Wrapped SOL counts against
  `native` and against a wrapped-SOL token limit both.
- `perDay` is the last 24 hours, every chain together, counted from `<name>.ledger.jsonl` beside the
  wallet.

A field the policy does not know is an error, so a typo never silently lifts a limit.

### Know how a send is measured

What a transaction moves is measured, not read from its calldata. An EVM transaction is simulated
with `eth_simulateV1` (a node method that runs it and returns its logs), and its token and native
transfers out of the wallet and its Pot are counted. A Solana transaction is simulated with the
accounts it writes reported. Every simulation of a transaction a wallet signs is unsigned, a swap's
stops in `sauce run` included: the wallet signs only a transaction its policy has let go, so an
endpoint never holds one it could send itself. An EVM transaction is made whole before the policy
measures it, with the gas it is signed with (1.2 times its estimate), its fees, nonce and chain;
every simulation of it runs with that gas and those fees, since a program can read both, and that
exact transaction is what the wallet signs. (`sauce send` sends what was signed elsewhere, and
simulates it first: on Solana the signed transaction itself, on an EVM chain its call with the gas
and fees it was signed with, the signed gas checked against what it needs; it unlocks no wallet.)
On Solana a transaction is held to the policy of every wallet it needs a signature from that the
command has unlocked, whichever of them pays its fee, and a planned transaction another tool built
must be paid for by the wallet that sends it. A limit that cannot be measured on the endpoint (one
without `eth_simulateV1`, for one) refuses the send. Every wallet send also holds to the
[supported chains](cli.md#supported-and-preview-chains).

A simulation shows what a transaction does on the state it ran on: the chain's head, a moment
before the transaction is sent. A program that reads the block it lands in (its time, its base
fee, what another transaction changed first) may do something else there, and no simulation bounds
that. A policy limits what the transaction does as simulated; a bound that holds whatever the
block would have to be enforced by the program as it runs, such as a `require` on what it sends.

### Know what a policy does to a signed cook

`sauce sign` signs a cook that another account sends later, on what the chain holds then, so a
simulation when you sign cannot measure what it will move. A wallet whose policy sets `native` or
any `tokens` limit therefore refuses to sign one, naming the limit. `chains` and `to` still apply:
the cook's chain, and its Pot as the address. Sign from a wallet without those limits, or from the
key elsewhere ([Signed cooks](signed-cooks.md#wallet-spending-limits)).

### Know what a policy does to `--fund`

Before `--fund` signs a pull, or sends an approval or a transfer to the Pot, a wallet's policy holds
it to `chains` and to `to` (the Pot as written), and the Pot must be the wallet's own
([Run a program](cli-run.md)). What the funding lets the Pot take, only a cook on the wallet's own
Pot spends, and that cook is measured and held to the `native` and `tokens` limits when it is sent.

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

`sauce tx` prints the transaction for the owner to sign (addresses and `sendCalls` are abbreviated here):

```text
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
send the first; only the owner can send the second. This output is abbreviated:

```text
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

## Let another account send it: `sauce sign`

`sauce sign` signs a cook without sending it, for a relayer or another account of yours to send
and pay the gas. It prints the signed cook and the transaction that sends it; anyone holding that
output may send it until its deadline, once. `sauce sign --cancel <nonce>` cancels one.
[Signed cooks](signed-cooks.md) walks through it.

## Other signers

Besides `--wallet`, a command signs with:

- `--keystore <path>`: a JSON keystore file, as `cast wallet` and geth write. It takes the same
  password sources.
- `--private-key <hex>`: works, with a warning, because it lands in your shell history.
- `--keypair <path>`, on Solana: a keypair file, the JSON array of 64 bytes `solana-keygen` writes.

None of these applies a policy: a policy limits a wallet only when it signs through `--wallet`, or
through the MCP server's wallet tools. Give one signer per command. The signer is always the Pot's
owner. On Solana with `--via engine`, which uses no Pot, the signer is the program's authority
instead ([Solana](cli-solana.md)).

## Next

- Run a program with the wallet you made: [Run a program](cli-run.md).
- Let a coding agent sign through your wallet's own MCP server:
  [Sign with your wallet's MCP server](wallet-mcp.md).
- Why a policy and a simulation protect you: [Safety](../concepts/safety.md).
- Before you run with real funds: the [production checklist](production-checklist.md).
