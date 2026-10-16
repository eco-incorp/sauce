# Solana from the command line

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Solana quick start](solana-quick-start.md)

> On Solana, `sauce` works the way it does on Base: you simulate a program, then run it. What
> differs is under the hood. A Solana transaction must list every account it touches, so `sauce`
> works the list out for you. A big program is uploaded in a few pieces before it runs, and `sauce`
> cleans up afterwards. This page covers those differences, and how to name an account yourself
> when you need to.

Start with the [Solana quick start](solana-quick-start.md) if you have not: it runs a program
end to end.

## The same commands

```sh
sauce compile pay.sauce.ts --chain solana --json
sauce pot --chain solana --wallet me-solana
sauce simulate pay.sauce.ts --chain solana --wallet me-solana --assume-balance USDC:5 \
  --args <recipient> 400
sauce run pay.sauce.ts --chain solana --wallet me-solana --args <recipient> 400
```

The Solana signers are `--wallet` with a Solana wallet, and `--keypair <path>` with a keypair file
(`~/.config/solana/id.json`, say). An `Address` argument is a base58 public key.

## The accounts

For the token methods (`USDC.transfer(to, amount)`, `USDC.balanceOf(ctx.self())`) and every account
a program writes where it uses it (`USDC.accountOf(to)`, `Solana.pda(program, [seeds])`), compiling
adds each account the program needs to `main`, with how to find it. `sauce compile --json` lists
them in its `manifest`:

```json
{ "kind": "slot", "index": 3, "name": "toUSDC", "requires": "writable", "derive": "@to:USDC" }
```

`simulate`, `run` and `tx` fill in each one from your wallet, your Pot and `main`'s arguments, so you
pass none. A recipient who has no account for the token yet gets one, created before the program
runs: the run asks first (or `--yes`), and you pay its rent.

### Naming an account yourself

A program can also take an account as a parameter, `Account`, `Account<Writable>` or
`Account<Signer>`. Then you name it with `--account NAME=<value>`:

```js
// @chain solana
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  dest: Account<Writable>,
  authority: Account<Signer>,
  mint: Address,
  amount: Uint256,
) {
  transfer(mint, tokenProgram, source, dest, authority, amount);
}
```

```sh
sauce run sweep.sauce.ts --keypair ~/.config/solana/id.json \
  --account tokenProgram=program:USDC --account source=pot:USDC \
  --account dest=<token account> --account authority=pot --args <mint> 400
```

A value is an address, or one of these:

| Value                       | The account                                           |
| --------------------------- | ----------------------------------------------------- |
| `pot`                       | your Pot, which the Kitchen signs for                 |
| `owner`                     | you, the signer                                       |
| `pot:USDC`                  | your Pot's USDC account (any token symbol, or a mint) |
| `owner:USDC`                | your own USDC account                                 |
| `@to:USDC`                  | the USDC account of `main`'s argument `to`            |
| `mint:USDC`, `program:USDC` | the USDC mint, and the token program that owns it     |
| `system`                    | the System Program                                    |

`--accounts <json | file>` gives them all at once, as one JSON object of names to values. The
[Solana guide](solana.md) has the language programs write their accounts in.

## What a run costs

- **The Kitchen's fee**, in lamports, read from the cluster. Every output prints it as `fee`, and
  the cook signs it as its most it will pay: if the fee rises before the cook lands, the cook fails.
  `--max-execution-fee <lamports>` refuses a fee above your own limit, before anything is signed.
- **Rent**, the deposit Solana charges for each new account. Your Pot keeps 10 KB of storage, so
  its rent is the big one, paid once. A token account's is small.
- **Transaction fees**, a fraction of a cent each.

## A program too big for one transaction

A Solana transaction holds at most 1,232 bytes. A larger program is uploaded first into a Kitchen
**code buffer**, in a few transactions, then run from there. The buffer is closed after the cook,
and its rent comes back. `sauce run` does all of it:

```text
staged the 759-byte program in 3 transactions
cook 5stq…A2k: success, 60220 compute units
…
closed the code buffer in 64or…18h4: success, 5874 compute units
```

When a cook names more accounts than fit, `run` puts them in an **address lookup table**, a list on
chain a transaction can point at. It prints the table's address, and keeps it for the next cook
naming the same accounts.

## Leftovers: `sauce reclaim`

A run closes its own buffer. A run that was stopped, or a plan never finished, can leave one open,
and lookup tables stay open on purpose. `sauce reclaim` lists them, with the rent each holds, and
closes them:

```sh
sauce reclaim --chain solana --owner <pubkey>                          # list, and print the closing transactions
sauce reclaim --chain solana --keypair ~/.config/solana/id.json --yes  # close them
```

## Through the Kitchen, or directly: `--via`

A program normally runs on your Pot, through the Kitchen. `--via engine` runs it directly on the
engine instead, with no Pot: you sign, and the program acts with your signature, spending your own
token accounts.

```sh
sauce run sweep.sauce.ts --keypair ~/.config/solana/id.json \
  --via engine --max-execution-fee 10000 \
  --account tokenProgram=program:USDC --account source=owner:USDC \
  --account dest=<token account> --account authority=owner --args <mint> 400
```

Use the Kitchen (the default) when the program holds or spends what the Pot owns, or writes the
Pot's storage. Use `--via engine` when it acts for your wallet, or needs one more level of calls
into other programs: with no Kitchen in between, it has one level more to spare. The fee is the
same either way. The [Solana guide](solana.md#two-ways-to-run-a-program) sets the two side by side.

## Intents

An intent cannot be published from Solana: open it from Ethereum or Base. Its destination may be
Solana, and `sauce intent fill`, `prove` and `cancel` act on it there
([Intents](cli-intents.md#an-intent-to-solana)).

## Details

### Account values in full

The value language `--account` takes, and `derive` in the manifest uses:

- an address in base58;
- `self`: the Pot, or the signer with `--via engine`; `pot`; `owner`; `system`: the System Program;
- `@to`: `main`'s argument `to`;
- `<holder>:<token>`: an associated token account. The holder is `pot`, `owner`, `self`, `@to` or a
  base58 key, and the token is a symbol, a base58 mint, or `@mint` for `main`'s argument `mint`. It
  is the holder's account for the mint, under the token program that owns the mint. A registered
  symbol's program is the registry's; any other mint's is read from the cluster. A tokenized stock
  is named by its symbol, in any case (`pot:TSLAx`, `mint:NVDA_US`);
- `mint:<token>` and `program:<token>`: the mint, and its token program (SPL Token or Token-2022),
  the accounts `transferChecked` takes;
- `slot:<pool>:<token>.<part>`: one of the nine accounts a venue's swap takes for a pool paying the
  token (`program`, `pool`, `config`, `vaultA`, `vaultB`, `extra`, `ticks0` to `ticks2`), read from
  the pool on the cluster: what a venue's namespace (`OrcaWhirlpool.swap(pool, …)`) adds;
- `pda:<program>:<seeds>`: the address a program derives for its seeds, comma-separated. A seed is
  `"text"` or a bare word, a key (`pot`, `owner`, `self`, `@to`, base58), `mint:USDC`, an integer
  (`u8:7` to `u128:7`, or `u64:@index` from an argument) or hex bytes after `0x`.

Whatever a derived account is made of must be known when the transaction is built. An `--account`
for a derived slot replaces its derivation. A slot with no `--account` is named with the role it
needs, and `simulate` notes each account it was given that the cluster does not have (a guard on it
fails with no message of its own). With `--via engine` there is no Pot, so no `pot:` account, and
`NAME=pot` for a slot that must sign is refused, since nothing signs for a Pot there. The
[Solana guide](solana.md#the-token-methods-every-account-derived) has what the lowering checks and
requires.

A `main` argument of type `Address` is a 32-byte public key: pass it in base58 (or as 32 bytes of
hex), and the command encodes the whole key as the word the engine reads (ABI-v1 only, not under
`--compact-args`).

### The Pot on Solana

A Pot is the Kitchen's program-derived address over the owner and the salt. `sauce pot --chain
solana --owner <pubkey>` prints it and the `create_pot` instruction; `--deploy` with a signer creates
it. It also lists the Pot's token account for each registered mint but the tokenized stocks, over a
thousand of them: its address, whether it exists and what it holds (`tokenAccounts` in its JSON). A
stock's is `pot:<symbol>`. A cook names its Pot by `--owner` and `--salt`, never `--pot`, and `run`
asks before creating a missing one.

### Simulating on Solana

`simulate` simulates the cook from `--owner` with signatures unchecked; a Pot the Kitchen has not
created yet is created by its `create_pot` ahead of the cook, in the same transaction. It prints the
compute units, what `main` returned (read as its declared type) and what the cook moved, or the
reason (a program's `throw` or `require` message, decoded from the engine's return data) and the
program logs.

What moved is read from the accounts themselves: every account the transaction may write, as it is
now and as the simulation leaves it (`simulateTransaction`'s `accounts`). Each token account's
balance change (SPL Token and Token-2022, in whole units by its mint's decimals, a mint the registry
records by its symbol) and each account's lamports are listed, named by their `--account` names, as
the owner, the Pot and the Kitchen's fee config; the owner's lamports include the transaction's fee.
`--json` lists them as `tokenChanges` and `lamportChanges`.

Solana's `simulateTransaction` takes no account overrides, so a plain simulation runs on the
accounts as they are, and the owner must hold the Pot's rent and the fees (a shortfall is named). A
cook too large for one transaction, or one given `--assume-balance`, is simulated in a local copy
instead: LiteSVM, a Solana runtime in a library. Every account the cook names is read from the
cluster, with the cluster's rent, the released engine and Kitchen, and the owner given the lamports
the staging and the fees take, so any address can simulate. The Pot is created where missing, the
program staged into a code buffer as `run` stages it, then the cook runs, its accounts through a
lookup table. There `--assume-balance TOKEN:amount` gives the account the cook spends that token
from (the Pot's, or the owner's with `--via engine`) that balance, and a `pot:<token>` or
`owner:<token>` account the cluster does not have yet is made empty, with a note: `run` creates it
before the cook. An `--owner` that is not a wallet (a program's account, or one holding data) is
refused, as it cannot pay. LiteSVM is installed the first time it is needed
([Runtime packages](cli.md#runtime-packages)).

### Running on Solana

`run` signs with `--wallet` or `--keypair`, confirms by polling the endpoint (no websocket to
configure), and prints the signature, status and compute units, and the logs when it fails. A
program too large for one transaction is staged in a Kitchen code buffer first, and the buffer is
closed again after the cook, or when staging or the cook's simulation fails; if closing it fails,
the run still prints the cook and warns with the buffer's address. A failure is named for the
program the logs show failing: the Kitchen's or the engine's refusals by name, and a token program's
in the words it logged.

Each account a transaction lists costs 32 bytes, and one taken through an address lookup table one
byte. `--lookup-table <address>` takes a cook's accounts through a table that holds them, on `run`,
`simulate` and `tx`, and `run` creates one for a staged cook whose accounts do not fit, paid by the
signer. `compile --json` reports `cook`: the size of the cook's transaction against the 1232-byte
limit, measured as `sauce run` builds it, with each `--account` given and a distinct account for
every other slot (the Kitchen's cook, or with `--via engine` the engine's direct one, which is
smaller: no Kitchen, Pot or salt). Past the limit, stderr says `sauce run` stages the program first.

### A cook in several transactions

`tx` prints the cook as a base64 transaction signed by no one, `{ chain, via, feePayer, pot, fee,
maxExecutionFee, transaction, cursor }`, for the owner's wallet to sign; its blockhash expires in
about a minute. A cook that needs more than one transaction (a program too large for one, staged in
a code buffer; accounts past one transaction's list, through a lookup table; a Pot or token account
to create first) is a plan of three steps: the setup, the cook, then closing the code buffer.
`sauce tx` prints the first step and the cursor the next is built from:

```json
{
  "chain": "solana",
  "step": "setup",
  "plan": [
    {
      "step": "setup",
      "what": "create the Pot; stage the 6447-byte program in a code buffer; create a lookup table for the cook's 41 accounts",
      "state": "next"
    },
    {
      "step": "cook",
      "what": "the cook, through the Kitchen, from the code buffer",
      "state": "later"
    },
    {
      "step": "close",
      "what": "close the code buffer, its rent back to the owner",
      "state": "later"
    }
  ],
  "transactions": [
    { "what": "creating the Pot", "transaction": "AQAB…", "feePayer": "<owner>" },
    { "what": "creating the code buffer", "transaction": "AQAB…", "feePayer": "<owner>" },
    { "what": "writing bytes 0… of the program", "transaction": "AQAB…", "feePayer": "<owner>" }
  ],
  "cursor": "sauce-plan-1.…"
}
```

The owner signs each transaction (it pays for every one, and none needs a fresh keypair), and
`sauce send` sends them with the cursor, which prints the step after under `next`, built fresh with
its own cursor:

```sh
sauce tx big.sauce.ts --chain solana --owner <pubkey> > step.json
sauce send <signed>… --cursor @step.json --json > next.json
```

Repeat until `next.step` is `done`; a setup of more than 32 transactions comes in several steps. A
step is built from what the cluster shows, so what landed is skipped and what did not is built
again: a signer slow enough to let the blockhash expire re-signs only what is left, which `--cursor`
alone (nothing sent) builds. A cook handed out is never built again while it can still land, nor
once the owner's transactions show it landed; one broadcast another way is confirmed with
`--signature <signature>`. `--close` gives up on the cook and closes the code buffer, once a cook
handed out can no longer land. A cook through a lookup table extended a moment ago comes back with
nothing to sign and a `wait` naming the slot the table is in use from, the next one, about half a
second on: `--cursor` alone, sent again, builds the cook (`sauce run` waits for it itself). A cook
its simulation says would fail is not built, so none is handed out to land and fail: the step says
why in `fails`, with the simulation's `logs` (`sauce tx` exits 1 then), and once what it needs is
there (a funded Pot, an account it names), `--cursor` alone simulates it again and builds it. A
lookup table the plan created stays for the next cook naming the same accounts
(`--lookup-table <address>`).

### `sauce reclaim` in detail

The tables it lists are the owner's that hold the Kitchen's execution-fee config, which every Sauce
cook's table holds; `--lookup-table <address>` names one outright, for an endpoint that refuses the
scan. With `--owner` alone it prints the transactions that close them, unsigned, for any signer and
`sauce send`; with the owner's key it asks, then sends them (`--yes` without asking). A buffer
closes in one transaction, its rent back at once. A table closes in two: deactivated now, and closed
once its deactivation slot has left the cluster's recent slot hashes, 512 slots (about three and a
half minutes) later; the listing says the slot it closes from, and the command run again then closes
it. It serves cooks until then, and none after: `--keep-tables` closes the buffers only.

Nothing in use is closed. A buffer, or an active table, that a transaction named in the last 300
slots (about two minutes) is listed `in use until slot <slot>` and left open, as a cook built for it
may still land. A plan you mean to carry on with, whose cook may be handed out later than that, is
kept whole with `--keep <cursor | @file>`, its cursor: its buffer and table stay open however long
its cook waits. One whose transaction history the endpoint cannot read is kept as in use too
(`historyUnread`), said in one note: nothing is closed on a guess.

A run takes 32 code buffers and 24 lookup tables at most, at most 30 transactions on one blockhash,
the tables it can close or deactivate first; an owner with more is told how many remain
(`remaining` in the JSON), for the next run once these are closed.

### `--via engine` in detail

`--via kitchen`, the default, is the Kitchen's `cook` on the owner's Pot, which the Kitchen signs
for. `--via engine` calls the engine's own paid cook (`cookAndPay`) with no Kitchen and no Pot:
nothing is created, `--owner` (or the signer's key) signs and pays the fee, and the program acts with
that signature. Give `--account NAME=owner` where it needs an authority, such as the owner of the
token account it spends from. The program's own calls get one more level of CPI depth, as no Kitchen
frame sits under the engine. A staged program runs pinned to the staged bytes' digest. The fee is
read from the Kitchen's config and paid into it either way. `compile --json` sizes either cook with
`--via`.

The flag is `--via` rather than `--entry` because "entry" is already the compiler's word for a
program's entry module and the arguments `main` takes (`--compact-args`, `entryEncoding`); `--via`
names what the transaction calls.

### Verifying a settle on Solana

`sauce verify --chain solana <signature> --min-out <n> --spl-count <n>` checks a settle cook: the
engine invocation it made, against the SDK's settle program recompiled for that floor and split
(`svm.verifySvmSettleExecution`). It rejects with `TX_FAILED` (the transaction failed),
`NO_SETTLE` or `NOT_GENUINE`. It reads a cook through the Kitchen: a settle cooked `--via engine` is
not one it checks.
