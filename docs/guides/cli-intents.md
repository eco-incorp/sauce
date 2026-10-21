# Intents from the command line

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Cross-chain intents](../concepts/cross-chain-intents.md)

> An intent is a job posted on one chain, with a reward, and done on another. You post it
> (**publish**). Someone called a solver does it (**fill**), proves it was done (**prove**), and
> collects the reward (**claim**). If nobody does it in time, you call it off (**cancel**) and take
> the reward back (**refund**). Each step is a `sauce intent` command, and `sauce intent status`
> tells you where an intent stands.

This page is every step, for the one who posts and for the one who fills. You need the `sauce`
command and a wallet, `me` here, made with `sauce wallet new me` as in the
[quick start](quick-start.md). [Your first cross-chain intent](first-intent.md) posts one from a
program, step by step, and [cross-chain intents](../concepts/cross-chain-intents.md) explains the
parties: the Portal, eco-routes' contract on each chain where intents are published, filled and
paid out; its Executor, which makes a fill's calls; the prover, which carries the proof of a fill
to the source chain; and the vault, where the reward waits.

Everything that sends, or prints a transaction to send, happens only on Ethereum, Base and Solana.
Publishing is refused when the source, or the destination of an intent the file opens itself, is a
preview chain; a fill, a proof and a cancellation by their destination; a claim and a refund by
their source. Simulations and dry runs run on any chain.

## Post one

There are three ways.

### From a program on your Pot

With `sauce run`, the program opens the intent, and can put an amount it measured into it, such as
what a swap just returned. [Your first cross-chain intent](first-intent.md) shows the program:

```sh
sauce run cross-chain-intent.sauce.ts --chain base --wallet me \
  --intent-deadline <unix seconds> --intent-creator <your address> --args <recipient> 1000000
```

### Step by step, with no file

`sauce intent publish` alone asks for each part, one question at a time: the chains, the token and
amount, the recipient, the reward and the deadlines. It writes the intent as a `.sauce.ts` file,
simulates it, and publishes it from your wallet when you agree. Every question has a flag, so it
runs with none:

```sh
sauce intent publish --source ethereum --destination base --token USDC --amount 1 \
  --recipient <your address> --reward-token USDC --reward 1.01 --prover HyperProver \
  --fill-deadline +1h --reward-deadline +1d --wallet me
```

It suggests a reward: what is delivered, plus a margin over what a solver spends on the destination,
doubled so a fill is worth a solver's while. It shows how it got there, and you can change it.

### From a file, from your wallet

`sauce intent publish <file>` publishes from your wallet, with no Pot. It takes a file whose intents
are fixed when it is built: every amount a number, a `main` argument, or a top-level `const` of
them. The file the step-by-step flow wrote is one, headed by the command that publishes it again.
For your own:

```sh
sauce intent publish <file> --chain ethereum --wallet me \
  --intent-deadline <unix seconds> --intent-creator <your address> --args <main's arguments>
```

`ethereum-to-solana.sauce.ts` ([An intent to Solana](#an-intent-to-solana)) and
`nested-intent.sauce.ts` ([nested intents](nested-intents.md)) are two such files. You can also
publish from Solana, with a Solana wallet: [An intent from Solana](#an-intent-from-solana).

### Give the deadlines and the creator

Every intent needs two things Sauce cannot know:

- `--intent-deadline`, the **fill deadline**: the last moment a solver may do the job, in Unix
  seconds. `$(($(date +%s) + 3600))` is an hour from now in most shells.
- `--intent-creator`, who may take the reward back if nobody does the job: you.

The command names whichever is missing, and refuses a fill deadline at or before now, which no
solver could ever meet (`sauce intent fill` still simulates one, with a note, to show the Portal's
refusal). Three more are optional:

- `--intent-reward-deadline <unix seconds>`, the **reward deadline**: from when an unproven reward
  can be refunded. It defaults to the fill deadline.
- `--intent-execution-fee <wei>`, the destination Kitchen's fee, needed when the intent's body
  compiles to a program of its own. `--intent-execution-fee auto` reads it from each destination's
  Kitchen, and says what it read.
- `--intent-prover <address>` overrides the prover the registry records for the pair.

With no file, `--fill-deadline` and `--reward-deadline` also take `+30m`, `+2h` or `+1d` from now.

## Follow it

The command keeps every intent it publishes, fills or touches, in `~/.sauce/intents`:

```sh
sauce intent list                    # every intent kept
sauce intent status <intent hash>    # where it stands, read from both chains
sauce intent show <intent hash>      # its route, reward, deadlines and what happened to it
sauce intent import <tx hash> --chain base   # keep the intents someone else's transaction published
```

`status` says the intent's state, `unfunded`, `funded`, `filled`, `cancelled`, `proven`,
`cancelProven`, `claimed` or `refunded`, and for each next step whether it can happen now, why not,
and from when. `sauce intent` alone, at a terminal, lists the intents and lets you pick one and act
on it.

## Fill it

To do the job yourself, as a solver, first try it:

```sh
sauce intent fill <intent hash>
```

That simulates the fill on the destination with no key, and prints what would happen: what moved,
the Portal's record of the fill, and anything left behind. Then do it for real, as the signer:

```sh
sauce intent fill <intent hash> --send --wallet me
```

It simulates again, now on your own balances, says what the fill spends, asks you to approve
(`--yes` approves ahead), and sends it. A fill proves itself in the same transaction where the
prover allows.

## After the fill

```sh
sauce intent prove <intent hash> --wallet me                   # carry the proof to the source chain
sauce intent claim <intent hash> --chain ethereum --wallet me  # pay the reward to whoever filled it
sauce intent cancel <intent hash> --wallet me                  # nobody filled it in time: call it off
sauce intent refund <intent hash> --chain ethereum --wallet me # give the reward back to its creator
```

- **prove** sends the proof on the destination, paying the prover's fee. Several intents with the
  same chains and prover share one proof.
- **claim** pays the reward on the source, once the proof has arrived. Anyone may send it; it pays
  whoever the proof names.
- **cancel** stops an intent nobody filled, strictly after its fill deadline. Prove the
  cancellation, and **refund** then pays the creator back before the reward deadline.
- **refund** returns the reward to its creator, once the Portal allows it: at once after a proven
  cancellation, and from the reward deadline for an intent no one proved.

With no signer, each prints its transactions unsigned, for a wallet to send in order.

## An intent to Solana

You publish an intent to Solana from Ethereum or Base, like any other. Write a file whose job pays a
Solana wallet, and give the wallet in base58:

```js
// Pays a Solana wallet USDC, for a USDC reward on the chain that publishes it.
function main(recipient: Address, amount: Uint256, reward: Uint256) {
  Solana(() => {
    USDC.transfer(recipient, amount);
  }).reward({ tokens: [{ token: USDC, amount: reward }] });
}
```

```sh
sauce intent publish ethereum-to-solana.sauce.ts --chain ethereum --wallet me \
  --intent-deadline <unix seconds> --intent-creator <your address> \
  --args <solana wallet> 1000000 1050000
```

Or let `sauce intent publish` make the file, step by step:

```sh
sauce intent publish --source ethereum --destination solana --token USDC --amount 1 \
  --recipient <solana wallet> --reward-token USDC --reward 1.05 --prover HyperProver
```

Before it builds either, the command reads Solana: which token accounts exist and, for a program,
whether the Pot Solana's Portal owns exists. A wallet with no account for the token gets one,
created by the route, and its rent (about 0.002 SOL) is added to what the solver brings. An intent
whose fill would not fit one Solana transaction, even with its accounts in a lookup table, is
refused before anything is sent.

The intent is filled, proven and cancelled through Solana's Portal program, and claimed or refunded
on its source like any other:

```sh
sauce intent import <tx hash> --chain ethereum
sauce intent fill <intent hash> --solver <solana key> --claimant <your address>
sauce intent fill <intent hash> --claimant <your address> --send --keypair <keypair file>
sauce intent claim <intent hash> --wallet me
```

`--claimant` is required: it is your address on the source chain, where the reward is paid, and a
Solana key is not one.

## An intent from Solana

An intent can also start on Solana. You pay the reward in a Solana token, say USDC, and a solver
does the work on an EVM chain, say Base. Solana's eco-routes Portal holds your reward in a vault
until a proof arrives that the work was done, then pays the solver on Solana. Nothing on the EVM
side changes: the solver fills it on Base as it fills any intent, and the proof travels back to
Solana through Hyperlane.

The file is an intent file like any other. `--chain solana` makes the reward Solana's: `USDC` in
`.reward(...)` is Solana's USDC mint, while `USDC` inside the braces is still Base's. Save this as
`solana-to-base.sauce.ts`:

```js
// Pays `recipient` 1 USDC on Base, for a 1.05 USDC reward escrowed on Solana.
function main(recipient: Address) {
  Base(() => {
    USDC.transfer(recipient, 1000000);
  }).reward({ tokens: [{ token: USDC, amount: 1050000 }] });
}
```

Publish it from a Solana wallet; the solver then fills it on Base and claims the reward on Solana:

```sh
sauce intent publish solana-to-base.sauce.ts --chain solana --keypair <your keypair file> \
  --intent-deadline <unix seconds> --intent-creator <your Solana key> --args <recipient>
sauce intent fill <intent hash> --claimant <solver's Solana key> \
  --send --keystore <solver's keystore>
sauce intent claim <intent hash> --keypair <solver's keypair file>
```

Publishing sends two Solana transactions for each intent: `fund`, which moves the reward into the
intent's vault, then `publish`, which announces it. The fill and the proof happen on the EVM chain,
and the claim or refund back on Solana.

## Choose how to publish

`sauce run` cooks the file on your Pot. Inside one transaction the Pot reads each intent's vault
from the Portal, pays the reward into it from its own balance, and publishes the intent, so the
intent may use a value the program measures as it runs.

`sauce intent publish` sends the source chain's transactions from your wallet, with no Pot: for each
reward token a `transfer` to the intent's vault (and, for a native reward, a plain send to it), then
`Portal.publish`. It prints each intent's hash, its vault and each transaction's result.

- **Arguments.** The file's `main` arguments go after `--args`, as for `sauce run`: the command
  fixes each into the intents, which is what lets a wallet publish them. An argument must be one
  word to be fixed (an address, an unsigned integer or a `bool`); an array, a record, bytes or a
  string is refused.
- **What is refused.** A file whose intent uses a value measured or computed on chain is refused,
  naming the value and pointing at `sauce run`, and so is one that does anything else.
- **`--dry-run`** simulates the transactions together (`eth_simulateV1`) and sends nothing, from the
  signer's wallet or `--from <address>`'s, printing each one's gas or revert (`gasUsed` and `reason`
  in `--json`). `--assume-balance USDC:2` (repeatable, `ETH:` for the native coin) gives that wallet
  the reward for the simulation only.
- **`--format json`** (or `cast`) prints the transactions unsigned, with `--from <address>` when
  there is no signer.

Publishing from Solana works differently: [From Solana, in detail](#from-solana-in-detail).

## Choose how the reward is funded

By default the reward is paid straight into the vault. The Portal counts an intent funded when its
vault holds the reward (`isIntentFunded`), which is what a solver checks once it sees
`IntentPublished`, so this needs no approval at all: nothing is left standing, and a USDT-style
token needs no reset.

The vault is the SDK's own derivation for the Portal's address. With an endpoint it is also read
from the Portal (`intentVaultAddress`), and when the two disagree nothing is sent: the command says
which address each reported. Only what the vault does not hold yet is transferred, so running the
command again publishes alone. The transfers go first, and `publish` is sent only once the Portal
counts the intent funded. A token whose `transfer` returns `false`, or keeps a fee, stops the
command before the intent is announced, with what was paid still in the vault: top it up and run it
again, or refund it after the reward deadline. A `--dry-run` reports `Portal.isIntentFunded` after
the simulated transactions, and `--format` prints each intent's `vault`, `vaultFrom` (`read` when
the Portal agreed, `derived` with no endpoint) and `fundVia`.

`--intent-fund-via publishAndFund` (also taken by `run`, `tx`, `simulate`, `compile` and `inspect`,
for intents a program opens) funds through the Portal instead: for each reward token an `approve` to
the Portal (reset to zero first when a smaller allowance stands, as SafeERC20 does; skipped when the
allowance already covers it), then `publishAndFund`, which pulls the reward into the same vault,
records the intent `Funded` and emits `IntentFunded`. Choose it when something you rely on reads
that event or status rather than the vault's balance.

Neither mode goes through Permit2. The Portal's Permit2 path (`publishAndFundFor` with Permit2 as its
permit contract) pulls through a Permit2 allowance to the intent's vault, which takes an on-chain
`Permit2.approve` per intent: the same number of transactions, plus a standing approval of Permit2.

## Make sure the shared intent Pot exists

Every intent whose body runs a program cooks on one Pot on its destination: the one owned by the
destination Portal's Executor with salt zero, which every intent through that Portal shares. No
solver can fill the intent until that Pot is deployed. `compile` and `sauce intent publish` check it
on the destination (`compile --json` reports each under `intentPots`) and warn while it is missing,
naming the `sauce pot --deploy --chain <destination> --owner <Executor>` that deploys it; any
account may send that. `publish` warns before it sends anything, and says how to check when it
cannot.

## Publishing with no file, in detail

The source is Ethereum or Base, and the destination Ethereum, Base or Solana (a Solana recipient in
base58). The token delivered is a registry symbol, or an address whose decimals it reads; the
recipient is you by default; the prover is one the registry records on both chains; and the reward
is funded by a transfer to the vault by default, or with `publishAndFund`. With no terminal, it
names every flag still missing; the funding, which has a default, is not one.

The suggested reward prices what a solver spends on the destination (the gas of a fill, the
prover's fee quoted from the destination's prover, and a Kitchen fee where the body cooks) in the
reward token, through a Uniswap V3 pool of the destination's wrapped native token. The fill deadline
is the last second a solver may fill; the reward deadline, when an unproven reward becomes
refundable, must leave time after it for the fill to be proven.

The file it writes is `--out`, else `intent-<source>-to-<destination>-<time>.sauce.ts`, headed by
the command that publishes it again; with a signer it publishes once you approve (or with `--yes`),
storing it.

## Simulating a fill, in detail

`publish --dry-run` simulates the source side: the reward paid into the vault, and `publish`. What
the intent does (the swap, the minimum it checks, the refund) runs on the destination, when a solver
fills it, and that is where it fails. `sauce intent fill` takes the file and the flags `publish`
does (or the intent's hash), and the destination's endpoint:

```sh
sauce intent fill <file> --chain ethereum \
  --intent-deadline <unix seconds> --intent-creator <your address> --intent-execution-fee auto \
  --no-prove --args <main's arguments>
```

### What it runs

For each intent the file opens, it runs one `eth_simulateV1` block on the intent's destination,
every call from a solver:

1. `Kitchen.deployPot(executor, 0)`, when the route cooks on the destination's shared intent Pot
   and it is not deployed yet. Any account may send it, and the Pot is the Executor's either way.
   The command also warns, with the `sauce pot` line that deploys it.
2. The solver's approval of the Portal for each token the route delivers, reset to zero first where
   a smaller allowance stands. The Portal pulls them from the solver.
3. The fill, which proves itself when it can: `Portal.fulfillAndProve(intentHash, route,
rewardHash, claimant, prover, sourceDomain, data)` when the reward's prover is a Hyperlane one,
   with the route's native amount (the Kitchen's fee for its cook) plus the prover's fee, quoted
   from its `fetchFee`, as the value; else, or with `--no-prove`, `Portal.fulfill(intentHash, route,
rewardHash, claimant)` with the native amount alone.

The prover is the destination's counterpart of the reward's (the registry's address for the same
role on that chain); it must serve the route's Portal, and the command checks the source prover
trusts it. The solver is an address nobody holds the key of, or `--solver <address>`, and the
claimant is the solver, or `--claimant <address | bytes32>`. The solver is given the route's tokens
and the value by state override.

### What it prints

On success it prints the gas, the transfers, each address's net change (an address given as an
argument is named by its parameter), the Portal's `IntentFulfilled` record, and what the fill left
in the shared Pot and the Portal's Executor. For an intent whose body swaps 998 USDC for WETH on
Base and pays the recipient, it looks like this:

```text
Intent 0xf261…5d2c from ethereum to base: the fill succeeds, gas used 1874288
Simulated with eth_simulateV1 on base, one block from the solver 0x5A0c…F111; nothing was signed or sent:
  1. approve the Portal for 998 USDC (gas 55425)
  2. Portal.fulfill(0xf261…5d2c, route, 0xe94c…0a6c, 0x5A0c…F111) with 3744785386350 wei: the route's nativeAmount, the Kitchen's fee for its cook (gas 1874288)
Assumed for this simulation only, by state override:
  the solver holds 998 USDC: the route's tokens, which the solver delivers (its balance word 0xc2e6…e5a4: Solidity mapping at slot 9)
  the solver holds 0.00000374478538635 ETH: fulfill's value
What moved, in order:
  [1] solver 0x5A0c…F111 -> Portal's Executor 0x645d…91Ca    998 USDC
  [2] Portal's Executor  -> shared intent Pot 0x48e8…744a    998 USDC
  …
  [4] 0x72AB…2D38        -> shared intent Pot                0.368481796891017787 WETH
  [5] shared intent Pot  -> 0x72AB…2D38                      998 USDC
  [6] shared intent Pot  -> recipient, refundTo 0x5a0C…Beef  0.368481796891017787 WETH
  …
Net balance changes:
  0x5A0c…F111 (the solver): -998 USDC, -0.00000374478538635 ETH
  0x72AB…2D38: -0.368481796891017787 WETH, +998 USDC
  0x5a0C…Beef (recipient, refundTo): +0.368481796891017787 WETH
  0x1984…506b (Kitchen): +0.00000374478538635 ETH
The Portal records the fill: IntentFulfilled(0xf261…5d2c, claimant 0x0000…F111)
Left behind: nothing. The shared intent Pot and the Portal's Executor end holding none of what the fill moved.
```

A fill that leaves tokens in the shared Pot or the Executor is warned about: every intent through
that Portal shares them, so a later intent's program or solver can take what is left.

A revert prints `the fill reverts: <reason>` and exits 1:

- a failed route call is unwrapped from the Executor's `CallFailed` down to its own reason
  (`route call 2 of 2 (the cook on the shared Pot 0x48e8…) reverted: the program threw "output below minOut"`);
- a cook that underpays the Kitchen shows `FeeNotPaid(<fee>, <paid>)`, which the command also warns
  about, naming the fee to build with;
- the Portal's own refusals are named: `IntentExpired()` with the deadline,
  `IntentAlreadyFulfilled`, `InvalidHash`.

`--json` carries one object per intent under `intents`: the hashes, `portal`, `executor`, `pot` and
`potDeployed`, `solver`, `claimant`, `value`, `proves`, `prover`, `fee`, `calls` (each with its
`status` and `gasUsed`), `assumed`, then `gas`, `fulfilled`, `transfers`, `approvals`,
`nativeTransfers`, `balanceChanges`, `otherLogs` and `leftBehind`; or `stage` and `reason`.

### Where it runs

It runs on the destination: `--rpc-url` is the destination's endpoint, for a file whose intents all
go to one chain. It needs `eth_simulateV1`, since the deployment, the approvals and the fulfill carry
state from one to the next. The intent must be fixed when it is built, as for `publish`: an intent
that uses a value the program measures on chain has no route until the program runs (name it by the
hash `sauce run` stored instead).

## Filling for real, in detail

A simulation sends nothing, so it runs on a preview chain too. With `--send` and a signer, the
signer is the solver, and the fill is sent, to a supported destination only.

It is simulated first exactly as above, but with nothing assumed: on the signer's own balances, so a
solver short of a token, or of the value, sees the simulation revert and nothing is sent. Then it
says what the fill spends (each token the route delivers, which the Portal pulls from you into its
Executor, and the value, split into the Kitchen's fee, what the route spends and the proof's fee)
and asks you to approve. With no terminal (or with `--json`) and no `--yes` it stops there.

The transactions go out in order, each simulated again just before, and it prints each one's hash,
block and gas, the gas cost, what the fulfill moved, the Portal's `IntentFulfilled` record and, when
the fill proved itself, the Hyperlane message id the proof travels as (the Hyperlane explorer finds
it by that id). The intent and the fill go into the store.

## Prove, claim, refund and cancel, in detail

- **`prove`** sends `Portal.prove(prover, sourceDomain, [intentHash…], data)` on the destination,
  for intents filled (or cancelled) there whose proof has not reached the source, with the prover's
  quoted fee as the value, approved as `fill --send`'s spending is. An intent the source has proven
  already is left out.
- **`claim`** checks that the reward's prover on the source has the intent proven, for its
  destination, and that the reward is neither withdrawn nor refunded, then sends `Portal.withdraw`
  (`batchWithdraw` for several hashes). It prints what left the vault. While the proof has not
  arrived it says so and exits 1, with when the store saw the intent filled and the Hyperlane
  message its proof travels as.
- **`refund`** sends `Portal.refund`, which anyone may send and which returns everything the
  intent's vault holds to the reward's creator, for a claimed one only its leftovers. It reads the
  state first and says why not, with the time left. There is no batch refund.
- **`cancel`** sends `Portal.cancel` on the destination, which anyone may send strictly after the
  fill deadline when no solver filled the intent: no fill can land after it. It needs a destination
  Portal with `cancel` and a source Portal whose `withdraw` refuses to pay a proven cancellation
  (`CancelledIntent`), both read from their code, since a cancellation is recorded as a claimant
  nobody controls; where either is missing it says so, and the reward is refunded after the reward
  deadline instead. Prove a cancellation once the cancel is final on the destination: a reorg that
  let a fill in first would leave that solver unpaid. `--and-prove` sends `cancelAndProve` instead,
  proving at once.

Signed or unsigned, each is refused on a preview chain: `prove` and `cancel` by the intent's
destination, `claim` and `refund` by its source.

## To Solana, in detail

- Solana is read as any chain is; a `--config` names its endpoint under its chain id, `1399811149`.
- **`fill`** sends `Portal.fulfill` from the solver: its token accounts pay the route's tokens into
  the Portal's executor, which runs the route's calls. The simulation runs on the accounts as they
  are (Solana's simulation takes no overrides, so `--solver` names a Solana key whose accounts hold
  the tokens) and prints the token accounts the fill moves. With `--send` and `--keypair` the fill is
  sent, then its proof: the Portal's `prove` through the HyperProver, with eco-routes' proof_helper
  paying Hyperlane's Interchain Gas Paymaster for the message's delivery in the same transaction.
  What the proof spends (the gas paymaster's quote and the message accounts' rent) is measured by a
  simulation and approved. `--no-prove` leaves it to `prove`.
- A fill too large for one transaction takes its accounts through an address lookup table. `fill`
  without `--send` lists the transactions that create it first, and cannot simulate the fill until
  the table exists; with `--send` it creates the table, waits a slot for it, then simulates and sends
  the fill. The table's rent is the solver's, and `sauce reclaim --chain solana` closes it later.
- **`prove`** and **`cancel`** sign with `--keypair`, which pays their fee: their transactions are
  built for it, so on Solana they need it. A cancellation's proof waits until the slot that cancelled
  it is finalized; `--and-prove` sends the cancellation and its proof in one transaction.
- **`claim`** and **`refund`** are the source chain's, as for any intent.

## From Solana, in detail

- **`publish`** sends two Solana transactions for each intent, signed by `--keypair` (or a Solana
  `--wallet`). First `fund` moves the reward from your token account into the intent's vault, an
  account Solana's Portal derives from the intent's hash. Then `publish` announces the intent so
  solvers can find it. They are two transactions because together they are larger than one Solana
  transaction can be. If the second fails, the reward waits in the vault: publish again, or refund
  it after the reward deadline. Both are simulated on the cluster first, and nothing is sent if
  either would fail. `--dry-run` only simulates; `--format json` prints them unsigned, for the
  wallet that `--from <key>` names. `--intent-creator` is a Solana key: the account a refund pays.
- The route has to fit in one Solana transaction, because the Portal takes it whole. Plain token
  transfers fit; a program body does not.
- **`fill`**, **`prove`** and **`cancel`** happen on the EVM destination, as for any intent.
  `--claimant` is required: it is the Solana key the reward will pay, since an EVM address cannot
  hold the reward. The proof goes to Solana's HyperProver, which accepts proofs from the EVM
  chains' HyperProver.
- **`claim`** and **`refund`** happen on Solana. Anyone may send them with `--keypair`, which pays
  the fee: the claim pays the claimant the proof names, and the refund pays the creator. Each opens
  the receiving token account first if it does not exist yet.
- **`import`** stores an intent someone published from Solana, by the transaction's signature:
  `sauce intent import <signature> --chain solana`.
- A Sauce program running on Solana cannot open an intent itself yet: compiling one says to publish
  it from a wallet instead.

## The store, in detail

Every intent `sauce intent publish`, `sauce run`, `sauce send` and the `sauce intent` verbs touch is
kept in `~/.sauce/intents` (`--store <dir>` for another): one directory per intent hash, holding
`intent.json`, the full intent (route, reward, chains, Portal, hashes, vault), written once and
never changed, and `events.jsonl`, one line appended per thing that happened to it (`published`,
`funded`, `imported`, `filled`, `proving`, `claimed`, `refunded`, `cancelled`), with its chain,
transaction, block and time.

Each event is read from the transaction as it lands (the Portal's own events, or on Solana its
instructions), so a transaction signed elsewhere and sent with `sauce send` is recorded as one the
command signed. Nothing is read and written back, so two commands at once cannot tear it, and where
an intent stands is never stored: it is read from the chains each time. No key or endpoint is
written there. The MCP server, run over stdio, keeps the same store
([What a local server keeps](mcp-local.md)).

`sauce intent import <tx hash> --chain <source>` stores the intents a transaction published,
rebuilt from its `IntentPublished` logs, each checked against its hash. `sauce intent` alone, at a
terminal, lists the stored intents with where each stands (read live from the chains), and on the
one you pick runs status, fill, prove, claim, refund or cancel, with the same approvals; with a
signer, they send. With no terminal it prints the list.

## Next

- Write the intents these commands publish, in a program or in TypeScript:
  [create an intent](intents.md).
- An intent whose job posts the next one: [nested intents](nested-intents.md).
- What each step does, and who you trust: [cross-chain intents](../concepts/cross-chain-intents.md).
