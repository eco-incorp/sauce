# Cross-chain intents

**Concept** · [Documentation](../README.md) · [Your first cross-chain intent](../guides/first-intent.md) · [Glossary](glossary.md)

> An intent is a job posting with a bounty. You say what must happen on another chain, and you lock
> a reward on this one. Someone else does the job with their own money, proves it, and is paid the
> reward. If nobody does it in time, the reward comes back to you. This page explains who does
> what, in what order, where the money waits, and what you trust.

This page is for anyone about to post an intent, or who has just posted one. It assumes you have
run a program on your Pot ([quick start](../guides/quick-start.md)) and know what a Pot and a cook
are ([Kitchen, Pot and cook](kitchen-pot-cook.md)). It has no steps to follow:
[your first cross-chain intent](../guides/first-intent.md) posts one.

## Why intents

A Sauce program runs on one chain, in one transaction: every step happens, or none does. No
transaction spans two chains, so a program cannot simply move on to another one.

An intent works around that by asking for the outcome instead of performing it. Your program says
"pay this person 1 USDC on Ethereum" and puts up a reward on Base. A **solver**, someone who
already holds funds on Ethereum, pays the person, then collects the reward on Base. You never sign
anything on Ethereum, and you never wait for a bridge.

Sauce builds intents for eco-routes, Eco's intent system. The SDK and the `sauce` command look up
every contract involved for each chain, so a program names only the chains, the job and the reward.

## The parties

| Who                  | Where                            | What it does                                                                                                                                  |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **You, the creator** | The source chain                 | Write the intent, pay the reward into escrow, and take it back if nobody earns it.                                                            |
| **Solver**           | The destination, then the source | Does the job with its own funds, proves it, and collects the reward. Anyone can be one.                                                       |
| **Portal**           | Every chain eco-routes is on     | eco-routes' contract, the job board: it publishes intents on the source, records fills on the destination, and pays rewards out.              |
| **Executor**         | The destination                  | A contract the destination Portal deploys and owns. It receives what the solver delivers and makes the job's calls.                           |
| **Prover**           | One on each chain                | Carries the destination Portal's record of a fill back to the source, as a cross-chain message, for a fee. Sauce uses Hyperlane's by default. |
| **Vault**            | The source chain                 | An escrow address, one per intent, worked out from the intent itself. The reward waits there.                                                 |

The **source** is the chain where the intent is posted and its reward waits. The **destination**
is the chain where the job is done.

## What an intent is made of

An intent has three parts:

- **The destination**, a chain.
- **The route**, what happens there: the tokens the solver must bring, the calls made with them,
  the native coin the solver sends along, and the fill deadline.
- **The reward**, what the solver earns on the source: tokens and native coin, the creator, the
  prover, and the reward deadline.

The intent's **hash** is computed over all three parts. Changing any field, a deadline or an amount
included, makes a different intent with a different hash and a different vault.

## The life of an intent

When all goes well, an intent goes through five steps:

1. **Fund.** The reward is paid into the intent's vault on the source. The vault's address follows
   from the intent's hash, so it exists before anything is published.
2. **Publish.** The source Portal announces the intent with an `IntentPublished` event. Solvers
   watch for it, and check with the Portal that the vault holds the whole reward.
3. **Fill.** On the destination, a solver calls the Portal's `fulfill`. The Portal pulls the
   route's tokens from the solver into its Executor, and the Executor makes the route's calls. The
   Portal then records the **claimant**, the address the solver names to be paid. An intent is
   filled once, before its fill deadline.
4. **Prove.** The destination Portal hands its record to its prover, which sends it to the reward's
   prover on the source. Whoever sends the proof pays the prover's fee; it is usually the solver,
   which often fills and proves in one transaction.
5. **Claim.** Once the proof has arrived, anyone may ask the source Portal to pay: the vault pays
   the reward to the claimant the proof names.

When nobody fills it, two more steps bring the reward back:

- **Refund.** Anyone may ask the source Portal to refund. It returns everything the vault holds to
  the creator, from the reward deadline on, when no fill was proven.
- **Cancel.** Strictly after the fill deadline, anyone may cancel an unfilled intent on the
  destination, so no fill can land later. Once the cancellation is proven to the source, the refund
  can happen at once, before the reward deadline.

`sauce intent status` names where an intent stands: `unfunded`, `funded`, `filled`, `cancelled`,
`proven`, `cancelProven`, `claimed` or `refunded`.

Each step is a separate transaction, often by a different party, on one of the two chains. The
source side (fund, publish) and the destination side (fill) are never one transaction.

## Two deadlines

An intent has two deadlines, both absolute times in Unix seconds:

- **The fill deadline**, the route's: the last moment a solver may fill it. After it, the intent
  can be cancelled.
- **The reward deadline**: from when an unproven reward can be refunded. When you do not set it, it
  is the fill deadline.

Leave time between them for a fill to be proven. A fill deadline too close gives no solver time to
act; a reward deadline too far keeps your reward locked up longer if nobody fills.

## Where the job runs

A route is a list of calls the Executor makes. What the calls are depends on the job:

- **A job that only moves tokens**, `USDC.transfer(recipient, amount)` and the like, becomes plain
  calls the Executor makes itself. It needs no Pot and no Kitchen fee.
- **Anything more** is a Sauce program, compiled for the destination and run as a cook on a Pot
  there.

A Pot accepts a cook only from its owner, and the caller is the Executor. So an intent's program
runs on the Pot the destination Portal's Executor owns, under salt zero: the **intent Pot**. There
is one per Portal, and every intent through that Portal shares it. It is not yours, and it is not
the solver's.

Two things follow from sharing:

- **It must exist before the fill.** On an EVM chain nothing in the route deploys it: a solver
  deploys it once, and a fill that would cook on a missing Pot fails whole. On Solana, the first
  intent's route creates it.
- **Nothing stays in it between intents.** A program brings assets in, uses them, and moves what is
  left out within the same fill. Tokens or an allowance left there are anyone's.

[The destination Pot](../guides/intents.md#the-destination-pot) says how to check it exists, and
how to deploy it yourself.

## Who pays what

The reward waits in the vault on the source until it is claimed or refunded. Nothing else moves
until a solver acts.

The solver pays everything on the destination: the tokens the route delivers, the native coin it
sends along (the Kitchen's fee for each cook, plus what the calls spend), the gas of the fill and
the prover's fee. Nothing on the destination pays any of that back. The reward is the solver's
only income, so the difference between the reward and what the solver delivers must cover its costs.

The SDK does not price the reward, and no solver is obliged to fill. `sauce intent publish`, when it
makes an intent step by step, suggests one: what is delivered plus a margin over the solver's costs
on the destination, where it can price them. A reward equal to what the solver delivers earns it
nothing, and will most likely be refunded to you instead. [Costs](costs.md) lists what each part
costs.

## Names follow the chain

An intent written in a program mixes two chains: `Ethereum(() => { ... }).reward({ ... })` inside a
program that runs on Base. Each name means what it means on the chain where its part runs:

- The braces, the job, run on the destination. `USDC` there is Ethereum's USDC.
- The reward is paid into the vault by the program, on the chain it runs on. `USDC` there is Base's.

[Names resolve per chain](../guides/intents.md#names-resolve-per-chain) shows what goes wrong when
a name is taken from the wrong chain.

## Intents that open intents

The job of an intent can itself open the next intent. When a solver fills the first, its program
runs on the destination and, in the same fill, pays the next intent's reward into a vault there and
publishes it. That is how a journey of several hops is written, each hop's amount measured when the
hop before it lands.

Each level is an intent of its own, filled, proven and claimed on its own. A later level failing
does not undo an earlier one. [Nested intents](../guides/nested-intents.md) shows how to write them.

## What you trust

- **Each step is all or nothing, the whole journey is not.** A fill either runs every call of the
  route or none. A failed `require` in the program undoes the whole fill. But publishing and
  filling are separate transactions on separate chains, so an intent can be published and never
  filled.
- **eco-routes' contracts.** The Portal, its Executor and its vaults decide who is paid. Sauce uses
  the deployments its registry records for each chain. The Portal pays a reward out only to the
  claimant a proof names, or back to the creator.
- **The prover.** The proof that a fill happened is a cross-chain message. The source pays whoever
  that message names, so an intent should use the prover the registry records for its two chains.
- **Solvers.** An intent is an offer. No one is obliged to fill it, at any price.
- **Your creator address.** A refund pays the creator, so it must be an address you control on the
  source chain.
- **The intent Pot.** It is shared. Whatever a program leaves in it can be taken by the next fill.

A cancellation is recorded as a claimant that nobody controls, so it is safe only with a source
Portal that refuses to pay that claimant. The `sauce` command checks this before it cancels.

## On Solana

An intent can go to Solana, published from Ethereum or Base: the job pays a Solana wallet, or runs
a small program on the Pot Solana's Portal owns. An intent can also start on Solana, published from
a Solana wallet, with its reward in a Solana token and its job on Ethereum or Base. The parties and
the steps are the same. Solana's Portal is a program, and a route there must fit in one Solana
transaction.

## Next

- Post one: [your first cross-chain intent](../guides/first-intent.md).
- Every step from the command line: [intents from the command line](../guides/cli-intents.md).
- Write one in a program or in TypeScript: [create an intent](../guides/intents.md).
