---
name: sauce-intents
description: Eco cross-chain intents that already exist — what an intent is (its destination, route and reward, its hash, the per-intent vault, the Portal on each chain, the prover) and every step of its life once it is published, whoever published it — reading it back from the transaction that published it, where it stands, filling it as a solver (simulated with no key, then sent), proving the fill, claiming the reward, refunding an unearned reward, cancelling an unfilled intent for an earlier refund, an intent to Solana, the shared destination Pot and what a solver pays — with a sauce intent command or an MCP tool each, and the Portal's functions, events and errors. Use when the user has an intent hash or the transaction that published one, wants to fill, prove, claim, refund or cancel an intent, acts as a solver, or mentions intents, rewards, vaults, solvers, Portals, provers or Executors.
---

# Eco intents

An intent is an **offer**: run this on the destination chain, and the reward escrowed on the
source chain is yours. A creator publishes it on the source chain's Portal; a solver fills it on
the destination; a proof travels back; the solver claims the reward, or, when nobody earns it, the
creator takes it back.

This skill is the life of an intent that already exists, whoever published it: a Sauce program
does not open one. Nothing about a fill is guaranteed: a solver decides whether the reward is worth
it, and the package prices nothing. Say an intent is _offered_, never that it _will execute_.

## Supported chains

Every step of an intent's life is sent only on **Ethereum, Base and Solana**, the chains Sauce
supports transactions on. Every other chain in the registry is a **preview chain**: `sauce intent
status` reads an intent there and `sauce intent fill` without `--send` simulates it, but the `sauce`
command and its MCP server build and send none of its transactions. Each step is refused by the
chain it is sent on, before anything is built, signed or sent: `fill --send`, `prove` and `cancel`
by the destination; `claim` and `refund` by the source.

The refusal names the supported chains and links the request for that chain (an MCP tool returns it
as `refused`, with the issue's title, body and a comment to post). To ask for a chain, find its
request among the existing ones
(https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support) and add the use case
as a comment, or open one from the form
(https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml): the chain and its id,
what you want to run there, the protocols and tokens it needs, and the volume expected and when.

## What an intent is

An intent is three values: the **destination** chain, the **route** (what runs there: a salt, the
route's deadline, the destination Portal, `nativeAmount`, the tokens the solver delivers, and the
calls) and the **reward** (its deadline, the creator, the prover, a native amount and tokens). Its
hash is `keccak256(abi.encodePacked(uint64 destination, keccak256(route bytes), keccak256(abi.encode(reward))))`,
so every field is in it, the deadlines too. **Changing any of them is a different intent**, with
its own hash and vault.

1. **Fund.** The reward sits in the intent's own **vault** on the source chain. Its address follows
   from the intent hash, so it exists before anything is published or deployed:
   `Portal.intentVaultAddress(destination, route, reward)` returns it, and tokens sent there count.
2. **Publish.** `Portal.publish` records the intent and emits `IntentPublished`, which solvers
   watch. It needs no funding and anyone may send it; sending it again re-emits the event.
   `publishAndFund` publishes and pulls the reward into the vault, and emits `IntentFunded` too.
3. **Discover and check.** A solver picks the intent up from `IntentPublished` (or from
   `IntentFunded`) and calls `Portal.isIntentFunded(destination, route, reward)`: true when the
   intent's status is Funded **or** the vault already holds the whole reward. A vault funded by a
   transfer counts, though the Portal's status for it stays Initial.
4. **Fill.** On the destination the solver calls the destination Portal's `fulfill`, sending the
   route's `nativeAmount` as value and delivering the route's tokens; the Portal's Executor runs the
   calls. Before the route's deadline, once. `fulfillAndProve` does the same and sends the proof in
   the same transaction, its value the `nativeAmount` plus the prover's fee.
5. **Prove.** The destination Portal's `prove(prover, sourceDomain, intentHashes, data)` hands what
   it recorded (the claimant, or a cancellation) to the destination's prover, which sends it to the
   reward's prover on the source chain for a fee it quotes (`fetchFee`). With Hyperlane, a relayer
   delivers the message; the source prover then records the claimant, which
   `provenIntents(intentHash)` returns.
6. **Claim.** Once the source has the proof, `withdraw(destination, routeHash, reward)`, sent by
   anyone, pays the vault's reward to the claimant the proof names (`batchWithdraw` claims several).
7. **Refund.** After the reward's deadline, with no proven fill, `refund(destination, routeHash,
reward)`, sent by anyone, returns everything the vault holds of the reward to the creator (the
   creator alone may send `refundTo` to choose another recipient). Before the deadline it reverts
   `InvalidStatusForRefund`. A vault that was funded but never published refunds the same way.
8. **Cancel, for an earlier refund.** Where the destination Portal has `cancel`, anyone may cancel
   an unfilled intent strictly after the route's deadline: no fill can land after it. Proving the
   cancellation (5) lets the creator refund at once, before the reward's deadline. A cancellation is
   recorded as a claimant no key controls, so the source Portal must refuse to pay it
   (`withdraw` reverting `CancelledIntent`); prove one only to a source Portal that does. Prove it
   once the cancel is final on the destination: a reorg that let a fill in first would leave that
   solver unpaid.

The Portal's functions, events and errors, with selectors and topics, are in
[references/portal.md](references/portal.md); each chain's Portal, Executor and provers are in its
file in `sauce-chains`.

## Every step from the command line

`sauce intent` drives the whole life. It stores an intent from the transaction that published it,
then each verb takes the intent's hash and reads both chains. The store is a directory in your
home (`--store <dir>` names another); where an intent stands is read from the chains each time.

```sh
sauce intent import <tx-hash> --chain <source>
sauce intent status <intent-hash>
sauce intent fill <intent-hash> --send --keystore <keystore>
sauce intent prove <intent-hash> --keystore <keystore>
sauce intent claim <intent-hash> --chain <source> --keystore <keystore>
sauce intent refund <intent-hash> --chain <source> --keystore <keystore>
sauce intent cancel <intent-hash> --keystore <keystore>
```

- `import` rebuilds each intent the transaction published from its `IntentPublished` log, checks
  its hash, and stores it (`--index <n>` picks one of several).
- `status` prints the intent's state on both chains (unfunded, funded, filled, cancelled, proven,
  cancelProven, claimed, refunded), its deadlines, and whether each next step can be taken now,
  with why not and from when. `list` shows every stored intent, `show` one in full.
- `fill` without `--send` simulates a solver's fill on the destination, with no key and nothing
  sent (below). `fill --send` fills it as a solver, from the signer: simulated first on the
  signer's real balances and not sent if it reverts, and what it spends (each delivered token, and
  the value) shown for approval (`--yes` approves). It sends the approvals (zero first where a
  smaller one stands), then `fulfillAndProve` with the prover's fee, or `fulfill` with
  `--no-prove`. It prints the Hyperlane message the proof travels as.
- `prove` sends the proof of a filled or cancelled intent, paying the prover's fee; several hashes
  with one destination share one proof. `claim` pays the reward once the source has the proof, and
  says so, with the message's id, while it has not; several hashes are claimed in one
  `batchWithdraw`. `refund` returns the reward when the Portal allows it, and says from when
  otherwise. `cancel` cancels after the route's deadline, refusing where either Portal lacks the
  cancellation support described above; `cancel --and-prove` proves it in the same transaction,
  before it is final.
- Without a signer, each prints its transactions unsigned, for a wallet to send in order; signed
  by any signer, `sauce send <signed>…` broadcasts them in order and reports each.
- `sauce intent` alone, at a terminal, lists the stored intents with where each stands, and runs
  these on the one picked.

## Without the CLI: the MCP tools

The same steps are tools of the Sauce MCP server: `sauce_intent_import`, `sauce_intent_status`,
`sauce_intent_fill`, `sauce_intent_prove`, `sauce_intent_claim`, `sauce_intent_refund` and
`sauce_intent_cancel`. The server keeps no intents: each call names one by its `record` (the JSON
`sauce_intent_import` returns, checked against its hash) or by `txHash` with its source `chain`,
and gives each chain's endpoint in `rpcUrls`. Each returns its transactions unsigned; a step that
cannot be taken yet is a result, `ready` false with `why`, not an error. `sauce_send` broadcasts
what the user signed.

## An intent to Solana

An intent Ethereum or Base publishes for Solana is filled, proven and cancelled on Solana, through
its Portal program, and claimed or refunded on its source as above.

```sh
sauce intent fill <intent-hash> --solver <solana-key> --claimant <address>
sauce intent fill <intent-hash> --claimant <address> --send --keypair <keypair>
sauce intent cancel <intent-hash> --keypair <keypair>
```

- `--claimant` is required: the address on the source chain the reward pays. A Solana key is not
  one.
- The simulation runs on the solver's accounts as they are, since Solana's simulation takes no
  overrides: the solver must hold the route's tokens.
- `fill --send` sends the fill, then the proof through the HyperProver, with Hyperlane's gas paid in
  the same transaction. Each spend is approved.
- `prove` and `cancel` sign with `--keypair`, which pays their fee. A cancellation's proof waits
  until the slot that cancelled it is finalized.

## The destination side

- **The shared Pot.** A route that runs a Sauce program cooks it on the destination Portal
  Executor's **shared Pot** (its owner is the Executor, its salt zero); the destination's file in
  `sauce-chains` gives the Executor, and `evm.intentPot` in
  [../sauce-chains/references/deployments.json](../sauce-chains/references/deployments.json) the
  Pot. **The Pot must exist before such a fill**: until it does, the fulfilment reverts
  (`CallToEOA`). `sauce intent fill` says whether it is deployed, and puts its deployment first,
  in the simulation and in what `--send` sends, when it is not (any signer may send it; the Pot is
  the Executor's either way). By hand, `sauce pot --chain <destination> --owner <Executor>` prints
  its address and deploy transaction. Anything left in the Pot after a fill belongs to the next
  intent through that Portal.
- **What the solver pays.** The destination Kitchen's fee for that cook is part of the route's
  `nativeAmount`: the solver sends it, in the destination's native coin, as the value of `fulfill`,
  and pays the destination gas too. Nothing in the reward pays either back, so the margin (the
  reward minus what the solver delivers) must cover both. Solvers apply checks of their own and
  decide which routes they fill.

## Simulate the fill before sending it

What an intent does runs on the destination, when a solver fills it, and that is where it fails.
`sauce intent fill <intent-hash>` simulates that fill with no key and sends nothing: in one
simulated block on the destination, the shared Pot's deployment when the route cooks on it and
nobody has deployed it yet, the solver's approval of the destination Portal for the delivered
tokens, then `Portal.fulfillAndProve` with the route's native amount and the prover's fee as its
value (or `Portal.fulfill` with the native amount alone, with `--no-prove` or a prover it does not
drive). The solver is given the delivered tokens for the simulation only (`--solver <address>`
simulates from a real one). It prints each transfer, each address's net change and what the
shared Pot and the Executor were left holding, which must be nothing; or why the fill reverts,
down to a failed call's own reason. A route deadline that has passed is simulated anyway, so the
Portal's own refusal (`IntentExpired`) shows.

By hand, as a solver sends it, on a fork of the destination with any client: hold the route's
tokens in an account and approve the **destination** Portal for each (`fulfill` pulls them from the
sender), then call `fulfill(bytes32 intentHash, Route route, bytes32 rewardHash, bytes32 claimant)`
with **value = the route's `nativeAmount`**, the claimant the solver's address as 32 bytes.
`sauce intent show <intent-hash> --json` gives the hashes, the route and the reward. Less value
reverts `InsufficientNativeAmount(sent, required)`, a missing Pot `CallToEOA(<Pot>)`, and a call
that reverts surfaces as the Executor's `CallFailed`, with the call's own reason inside.

## Examples

- [examples/intents.mts](examples/intents.mts) builds an intent by hand, rebuilds it from the
  `IntentPublished` log its publication emits as `sauce intent import` does, and pins the hash
  formula, the vault, the shared Pot and each step's Portal call, and every selector and topic
  [references/portal.md](references/portal.md) gives, to the registry's Portal.
