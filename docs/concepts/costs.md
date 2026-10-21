# Costs

**Concept** · [Documentation](../README.md) · [Kitchen, Pot and cook](kitchen-pot-cook.md) · [Safety](safety.md)

> Running a program costs a little, like posting a parcel: the network charges for carrying the
> transaction, and the Kitchen, the contract that makes Pots, charges a small flat fee for each run.
> Trying a program first is free. This page says what each thing costs, who pays it, and where you
> see the figure before you pay.

This page is for you once you know what a Pot, a cook and the Kitchen are
([Kitchen, Pot and cook](kitchen-pot-cook.md)). It explains costs and gives no steps:
[Run a program](../guides/cli-run.md) shows the commands that print them.

## At a glance

| What                                | Who pays                                   | Paid in                           | How much                                           |
| ----------------------------------- | ------------------------------------------ | --------------------------------- | -------------------------------------------------- |
| Simulating a program                | nobody                                     | nothing                           | free                                               |
| A cook's gas                        | the wallet that sends the cook             | the chain's native coin           | depends on the program; the simulation says        |
| The Kitchen's fee                   | the wallet that sends the cook             | the chain's native coin           | a flat fee per cook, set on chain                  |
| Native coin a program spends        | the Pot, or the wallet in the cook's value | the chain's native coin           | what the program spends                            |
| Deploying a Pot on Ethereum or Base | whoever sends the deployment, once         | the chain's native coin           | its gas only                                       |
| Creating a Pot on Solana            | its owner, once                            | SOL                               | about 0.072 SOL of rent, plus fees                 |
| A token account on Solana           | whoever creates it                         | SOL                               | about 0.002 SOL of rent                            |
| An intent's reward                  | its creator                                | the reward's tokens               | what you offer, enough to cover the solver's costs |
| An intent's fill                    | the solver, who then claims the reward     | the destination's coin and tokens | what the job needs on the destination              |

The **native coin** is the coin a chain charges its fees in: ETH on Ethereum and Base, SOL on
Solana. The tokens your program moves, such as USDC, come from your Pot and pay none of these.

## An example: the quick start's cook

The [quick start](../guides/quick-start.md) simulates a program that pays 1 USDC. Its output says:

```text
The cook succeeds from 0x028e…4822: gas used 111821 for the cook, after the Pot's deploy (1. below), returns 0x
…
  [1] wallet 0x028e…4822 -> Pot 0x4955…aD84      0.00000374478538635 ETH  the cook's value
  [2] Pot                -> Kitchen 0x…          0.00000374478538635 ETH  the Kitchen's fee
  [3] Pot                -> 0x2222…2222          1 USDC
```

Read it as a bill:

- **Gas: 111,821.** The network's charge for running the cook, paid by the wallet in ETH at the
  chain's gas price at that moment.
- **The Kitchen's fee.** The wallet sends it to the Pot as the cook's value, and the Pot passes it
  to the Kitchen. That run, it was 0.0000037 ETH.
- **The Pot's deploy.** This wallet had no Pot yet, so the simulation deploys one first. That costs
  gas once, and never again.
- **1 USDC** leaves the Pot. That is the payment itself, not a cost.

## Gas

Every transaction on an EVM chain, such as Ethereum or Base, pays **gas** to the network in the
chain's native coin. It is the network's charge, not Sauce's, and the wallet that signs the cook
pays it. A cook's gas is the transaction's, the Kitchen's and the Pot's, plus the program's own,
which the engine runs step by step.

Measured on a local chain through the released engine and a Pot the Kitchen made:

| What                                                | Gas, about                                   |
| --------------------------------------------------- | -------------------------------------------- |
| A cook whose program does almost nothing            | 43,000, the transaction's 21,000 included    |
| One loop iteration that adds two numbers            | 1,000                                        |
| Writing an array element, or reading one            | 500, or 300, on top                          |
| A call to a contract the transaction already called | 2,000 on top, plus what that contract spends |
| The first call to a contract in the transaction     | 2,600 more than a later one                  |
| `crypto.keccak256(abi.encode(a, b))`                | 2,000                                        |

Loops are what add up: a hundred iterations of a little arithmetic cost about 100,000 gas. The real
figure for your program is the simulation's, on the chain as it is when you run it. A swap that
crosses more of a pool's price range than it did in the simulation spends more, so leave room
between the simulated gas and the limit when the chain can move before your cook lands.

On Base and other chains built the same way (OP Stack), each transaction also pays a small fee for
publishing its data to Ethereum. The `sauce` command counts it in what a run cost.

A cook that fails still pays the gas it used up to the failure. It pays no Kitchen's fee.

## The Kitchen's fee

Every cook pays the Kitchen a flat fee, whatever the program does:

- **It is paid in the native coin**, as the cook's value, even when the program moves only tokens.
  What the Pot already holds does not pay it, and native coin the program spends comes on top.
- **It is set on chain.** The Kitchen's owner sets it, and it can change. The `sauce` command reads
  it when it builds a cook. A cook built with less than the current fee reverts, so a fee that rises
  between building and landing fails the cook, and nothing moves.
- **A cook that reverts pays none.** The fee reverts with the rest of the transaction.

On Solana the fee is in lamports, SOL's smallest unit (1 SOL is 1,000,000,000 lamports). The cook
states the most it will pay, so a fee that rises before it lands fails the cook.

## A Pot

On Ethereum and Base, a Pot is deployed once, by a transaction to the Kitchen that carries no fee:
it costs its gas, about 536,000 in a simulation on Base. Anyone may send it, and the Pot is its
owner's either way. `sauce run` sends it the first time a run needs it, as a transaction of its own
before the cook, and asks you first.

On Solana a Pot is an account, and Solana charges **rent** for every account: a deposit in SOL in
proportion to the account's size, which stays with the account. A Pot keeps 10,240 bytes of storage
for your programs, so its rent, about 0.072 SOL, is the largest first-run cost. The owner pays it
once, when the Pot is created.

## On Solana

Besides the Pot, a first run on Solana can pay for:

- **Token accounts.** On Solana a token balance lives in a token account, one per holder and token.
  A token account takes 165 bytes, about 0.002 SOL of rent. A run creates your Pot's for a token
  the first time it holds that token, and a recipient's if they never held it, and you pay that
  rent.
- **A code buffer.** A program too big for one transaction is uploaded first into a code buffer,
  which holds rent while it exists. The buffer is closed after the cook, and its rent comes back.
- **A lookup table.** A cook naming many accounts lists them in an address lookup table, which
  holds rent until it is closed. `sauce reclaim` lists what is still open and closes it.
- **Transaction fees.** 5,000 lamports for each signature, a fraction of a cent.

[How Sauce runs on Solana](solana-model.md) explains token accounts, staging and lookup tables.

## An intent

An [intent](cross-chain-intents.md) is a job on another chain with a reward attached. Its costs
fall on two sides:

- **The creator** locks the reward on the source chain, in the intent's vault, and pays the gas to
  publish the intent there. Published from a program, that is part of a cook, with its fee.
- **The solver**, whoever does the job, pays everything on the destination: the tokens the job
  delivers, the gas of the fill, the destination Kitchen's fee when the job runs a program, and the
  fee of the prover, the bridge that carries the proof of the fill back. It then claims the reward.

So the reward has to cover what the solver spends there, with a margin, or nobody fills it.
`sauce intent publish`, when it makes an intent step by step, suggests a reward: what is delivered
plus a margin over the solver's costs there, where it can price them, and shows how it got there.
Otherwise you set the reward yourself. A job made only of token transfers and approvals runs as
plain calls with no cook, and pays no Kitchen's fee.

An intent nobody fills loses its creator only what publishing it and refunding it cost: after the
reward deadline, the reward can be refunded.

## Seeing the figure before you pay

A simulation is free and shows every cost before you sign:

- On Ethereum and Base, the gas, the cook's value and the Kitchen's fee, and a Pot deployment when
  one is needed.
- On Solana, each first-run cost under the lamport changes (the Pot's rent, each new token
  account's, a code buffer's, a lookup table's), the fees of the transactions before the cook, and
  the total.

After a run, `sauce run` prints what it cost: the gas at the price the receipt records, an OP Stack
chain's data fee, and the value the cook carried. A spending limit on a wallet caps what it may
send, per transaction and per day ([Wallets and signing](../guides/cli-wallets.md)).

## Next

- What can go wrong, and what to check before you sign: [Safety](safety.md).
- The words on this page: the [glossary](glossary.md).
