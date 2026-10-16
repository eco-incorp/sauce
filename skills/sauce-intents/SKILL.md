---
name: sauce-intents
description: Cross-chain intents written in Sauce. An intent file opens the intent in main, Base(() => { ... }).reward({ ... }), its inputs main's parameters passed with --args; on which chain each name resolves (the body and delivery on the destination, the reward on the source); token-only bodies against program bodies, the delivery, the shared destination Pot and the Kitchen fee the solver pays; the deadline, creator and fee every intent needs; every way to publish and fund one (from a wallet, from a Pot, a transfer into the vault, quoted intents with publishAndFund); the lifecycle (the intent hash, the vault, IntentPublished, IntentFunded, isIntentFunded, fill, prove, claim, refund, cancel), a sauce intent command for each step, an intent to Solana; cascades; simulating both sides. Use when a program should continue on another chain, forward a swap or bridge output, build a cascade, pay a solver, or when the user mentions intents, rewards, vaults, solvers, Portals, provers, Executors or the shared Pot.
---

# Cross-chain intents

An intent is an **offer**: run this on the destination chain, and the reward escrowed on this chain
is yours. A solver decides whether the reward is worth it; the package prices nothing, so say an
intent is _offered_, never that it _will execute_. This skill owns intents whole: writing the file,
on which chain each name resolves, publishing and funding, the lifecycle and its `sauce intent`
commands, cascades, the destination side, and simulating both sides. It is the one skill that names
the Portal, its provers and its Executor.

## When to use

| Task                                                          | Here | Elsewhere                                        |
| ------------------------------------------------------------- | ---- | ------------------------------------------------ |
| Continue on another chain; forward a swap or bridge output    | yes  |                                                  |
| Publish, fund, fill, prove, claim, refund or cancel an intent | yes  |                                                  |
| A cascade (an intent opened inside another's body)            | yes  |                                                  |
| Which chains take intents; a chain's Portal and Executor      |      | each chain's file in `sauce-chains`              |
| The body's own program (a swap, a protocol call)              |      | `sauce-swaps`, `sauce-protocols`, `sauce-script` |
| An intent built from TypeScript                               |      | `sauce-typescript`                               |

## Core model

- **An intent is three values**: the **destination** chain, the **route** (what runs there: a
  salt, the route's deadline, the destination Portal, `nativeAmount`, the tokens the solver
  delivers, the calls) and the **reward** (its deadline, the creator, the prover, a native amount,
  tokens). Its hash is
  `keccak256(abi.encodePacked(uint64 destination, keccak256(route bytes), keccak256(abi.encode(reward))))`,
  so every field is in it, the deadlines and the destination Kitchen's fee (`nativeAmount`)
  included: **changing any is a different intent**; rebuild every transaction, an unsigned one
  printed earlier included.
- **An intent file is a program**: a chain name called as a function opens the intent, inside
  `main`, and every value the file does not compute is a typed `main` parameter passed with
  `--args` (`sauce-script`).
- **It is compiled for the source chain** (`--chain`), the one that pays the reward.
- **The reward sits in the intent's own vault** on the source, an address that follows from the
  intent hash, so it exists before anything is published or deployed.
- **A program body cooks on the shared intent Pot** of the destination, which every solver drives
  and which holds nothing of anyone's between intents.
- **Transactions only between supported chains** (`sauce-overview`): an intent publishes only when
  its source and every destination it opens are supported; each later step is refused by the chain
  it is sent on (`fill --send`, `prove` and `cancel` by the destination; `claim` and `refund` by
  the source). A cascade's later levels are not checked: keep every level on a supported chain.

```sauce chain=base
function main(recipient: Address, amount: Uint256) {
  Ethereum(() => {
    USDC.transfer(recipient, amount); // Ethereum's USDC: the body runs there
  }).reward({ tokens: [{ token: USDC, amount }] }); // the source chain's USDC
}
```

## On which chain each name resolves

| Part of the intent                                     | Resolves on       | Notes                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.reward(...)`                                         | the source chain  | it funds and escrows the reward. A reward token must be known when the file is compiled: a symbol, a literal address on the source, a top-level `const` of a literal, or, published from a wallet, one of `main`'s arguments. Its amount may be a measured value. From Solana `USDC` is Solana's mint, and `--intent-creator` a Solana key |
| The body (inside the braces) and the delivery argument | the destination   | every name a chain supplies: in an `Ethereum(...)` body `USDC`, `AaveV3.Pool`, `chainId` and a `Namespace_Contract` name are Ethereum's                                                                                                                                                                                                    |
| An intent opened inside a body                         | that body's chain | the rule repeats at every depth: its reward resolves there, its own body on its own destination                                                                                                                                                                                                                                            |

- **Name a token by a symbol, a literal or a top-level `const` of a literal.** Any other top-level
  `const` holding a token's address (`const TOKEN = USDC;`), used in the reward or the delivery,
  counts as a value the program computes, so the compile refuses the intent (the token's address
  must be known when the intent is built), and so does `sauce intent publish`. A `const` inside the
  braces is fine.
- A literal address means that address everywhere, and so does one of `main`'s arguments.
- A destination's tokens are in
  [../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md), with addresses in
  its file in `sauce-chains` ([../sauce-chains/references/ethereum.md](../sauce-chains/references/ethereum.md)
  for Ethereum).

## Two kinds of body

| The body is…                                                                                          | Lowers to                                                    | Needs                                                                  | Token writes                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| only `transfer`/`approve` calls on a symbol or `Token(address)`, with literal or captured arguments   | plain calls the destination Portal's Executor makes          | nothing more: no Pot, no Kitchen fee                                   | USDT works and `approve` is reset to zero first, but a `false` return is **not** detected |
| anything else: a local, a balance read, a condition, a protocol call, `transferFrom`, a nested intent | a program compiled for the destination and cooked on its Pot | the destination's Kitchen fee, and the delivery as the second argument | SafeERC20: a `false` return reverts the fulfilment                                        |

The Executor checks only that each call did not revert, so a token-only body's transfer that
returns `false` fills the intent with nothing moved; a call with data to an address with no code
reverts `CallToEOA`. A program body must say what the solver delivers, because a balance read inside
it reads what is there, not what must be brought:

```sauce chain=base
function main(beneficiary: Address) {
  const amount = USDC.balanceOf(ctx.self());
  const delivered = amount - (amount * 10) / 10000;
  Ethereum(
    () => {
      USDC.approve(AaveV3.Pool, delivered);
      AaveV3.Pool.supply(USDC, delivered, beneficiary, 0);
    },
    { tokens: [{ token: USDC, amount: delivered }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}
```

The gap between `delivered` (brought on Ethereum) and `amount` (paid on Base) is the solver's
margin: make it worth filling.

On Solana the two kinds lower to Solana's own instructions, and every amount in the body is fixed
when the intent is built: see [An intent to Solana](#an-intent-to-solana).

### A whole program as the body

The body can be any program for the destination, written inside the braces, using `main`'s
parameters as values and what the file declares (its imports, an ABI or a library, and its helper
functions), each compiled into the body's program for the destination. It calls contracts as any
program does (`sauce-script`) and swaps through `@sauce/router` (`sauce-swaps`), imported at the top
of the file. Every unsold input and every output leaves the shared Pot before the body ends, and a
refund the body makes lands on the destination. Because the shared Pot holds nothing of anyone's
between intents, a body may return a token's whole balance there, as below; a program on an owner's
Pot returns only what is left of its own amount instead.

A one-pool swap, with the guard every swap needs: WETH a solver delivers on Base is sold on the
Uniswap V3 0.05% pool down to `sqrtPriceLimitX96`, at least `minOut` USDC goes to `recipient`, and
any unsold WETH to `refundTo`, on Base. A fill below `minOut` reverts the whole fulfilment, so set it
from the limit (`sauce-distributed-swap` has the recipe), never above what the pool can pay.

```sauce chain=ethereum
import { uniswapV3 } from "@sauce/router";

function main(
  amountIn: Uint256,
  reward: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
  refundTo: Address,
) {
  Base(
    () => {
      const pool = UniswapV3.Factory.getPool(WETH, USDC, 500); // Base's 0.05% tier
      require(pool != 0, "no WETH/USDC pool at 0.05%");
      // Pays the recipient the USDC, and reverts the whole fulfilment below minOut.
      uniswapV3(pool, WETH, USDC, amountIn, sqrtPriceLimitX96, minOut, recipient);
      const unsold = WETH.balanceOf(ctx.self()); // the shared Pot: return all of it
      if (unsold > 0) {
        WETH.transfer(refundTo, unsold);
      }
    },
    { tokens: [{ token: WETH, amount: amountIn }] }, // Base's WETH, which the solver delivers
  ).reward({ tokens: [{ token: WETH, amount: reward }] }); // the source chain's WETH
}
```

`reward` must exceed what the solver delivers, `amountIn`, by what filling costs it (The
destination side). To buy WETH instead, swap `USDC` for `WETH` and deliver USDC: USDC is token1 on
Base, so the limit is then a ceiling, the `buy` block of `sauce price`.
[examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the same with a distributed swap
as the body: one pass over every Uniswap V3 and hookless V4 pool of the pair, each offered the WETH
still unsold up to its own fee-adjusted limit, skipped with no liquidity or past that limit.

## What you pass

The Portal, the prover, the destination Pot and the encoding are looked up from the eco-routes
registry, which records each chain's Portal and a prover deployed on both sides. Each chain's file
in `sauce-chains` says whether it takes intents and gives its Portal and Executor
([../sauce-chains/references/index.md](../sauce-chains/references/index.md)); the shared intent Pot,
the same on every chain, is `evm.intentPot` in
[../sauce-chains/references/deployments.json](../sauce-chains/references/deployments.json). Three
values are the developer's:

| Flag                               | What it is                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--intent-deadline <unix seconds>` | when the intent must be filled by                                                                                                                                                                                                                     |
| `--intent-creator <address>`       | who may reclaim an unearned reward; never a Pot                                                                                                                                                                                                       |
| `--intent-execution-fee <wei>`     | for a program body: the destination Kitchen's fee, mutable and on the destination, so read it there just before sending (an `eth_call` of `executionFee()` on `evm.kitchen`), or pass `auto`. An increase before the fill makes the fulfilment revert |

Amounts are base units (`1000000` is 1 USDC); only `--assume-balance` and `--fund` take whole
tokens. In `--args-json`, write an address or any value past 2^53 as a JSON string
(`"1000000000000000000"`): a JSON number loses precision. Refused at compile time, never silently
changed: a name the program does not declare, a missing deadline, creator or fee, a chain with no
eco-routes deployment, a pair with no prover deployed on both sides.

## Publishing and funding

| Way                                       | What is sent                                                                                     | Emits                             | Choose it when                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| (a) From a wallet, `sauce intent publish` | a transfer of each reward token to the intent's vault, then `publish`: no approval               | `IntentPublished`                 | every amount is known when you build it, and a wallet pays                          |
| (b) From a Pot, `sauce run`               | the same, by the Pot, inside the cook, with the vault read from the Portal                       | `IntentPublished`                 | an amount is measured on chain, or the intent must open atomically with other steps |
| (c) Transfer into the vault, by hand      | a token transfer to `intentVaultAddress(...)`, then `publish`, for an intent you encode yourself | `IntentPublished`                 | the intent was not built from a file the package compiles                           |
| `--intent-fund-via publishAndFund`        | (a) or (b) with `approve(Portal, reward)` per token, then `publishAndFund`                       | `IntentPublished`, `IntentFunded` | an intent built from a solver's quote (below)                                       |

Funding by transfer needs no approval, so no allowance is left standing and USDT needs nothing
special. The vault counts whatever it holds, so `isIntentFunded` is true from the moment the
transfer lands; the intent's status stays Initial (only `publishAndFund` or `fund` set Funded), and
`isIntentFunded`, the check solvers make, accepts either. The reward always goes into the vault
**before** `publish` is sent, so a solver that sees `IntentPublished` finds the intent funded.

**(a) From a wallet.** `sauce intent publish` builds each intent before anything runs, so every
amount must be a literal or one of `main`'s arguments, which it binds into the intents as given (each
one word: an integer, an address or a bool), and the file may do nothing but open intents (a file
with an amount measured or computed on chain is refused, with `sauce run` named instead). For each
intent it computes the vault from the Portal's address and the intent and, with an endpoint, reads
it from the Portal's `intentVaultAddress`: the two must agree, or nothing is sent. The wallet then
transfers each reward token to the vault (and sends a native reward to it), only what the vault does
not hold yet, and calls `publish(destination, route, reward)` once the Portal reports the intent
funded. A token whose transfer returns `false` stops it there, before the intent is published, with
what was paid still in the vault: top it up and run it again, or `refund` after the deadline. A
second run that finds the vault funded only publishes.

```sh
sauce intent publish pay-on-ethereum.sauce.ts --chain base \
  --from <address> --dry-run --assume-balance USDC:1 \
  --intent-deadline <unix seconds> --intent-creator <address> --args <address> 1000000
sauce intent publish pay-on-ethereum.sauce.ts --chain base --from <address> --format json \
  --intent-deadline <unix seconds> --intent-creator <address> --args <address> 1000000
```

- `--dry-run` simulates the transfers and `publish` together from the wallet, reports what
  `isIntentFunded` returns after them, and sends nothing; `--assume-balance USDC:1` (whole tokens)
  gives the wallet the reward for the simulation only. Without `--dry-run`,
  `--keystore <keystore>` in place of `--from` signs and sends them.
- `--format json` (or `cast`) with `--from` and no signer prints the transactions unsigned, for that
  wallet to send in order, transfers first, with each intent's `vault`. Only what the vault does not
  hold yet is transferred (with `--offline`, the vault is the package's own computation and each
  transfer is for the whole reward). Send `publish` only once the transfers have landed.
- With no file, at a terminal, `sauce intent publish` asks for the chains, the token and amount
  delivered and to whom, the reward (suggested: what is delivered plus a margin over the solver's
  destination costs), the deadlines, the prover and how the reward is funded, writes the intent as a
  `.sauce.ts` file, simulates publishing and filling it, and publishes it once approved. Each
  question has a flag (`--source`, `--destination`, `--token`, `--amount`, `--recipient`,
  `--reward-token`, `--reward`, `--prover`, `--fill-deadline`, `--reward-deadline`,
  `--intent-fund-via`), so it runs without a terminal.

**(b) From a Pot.** `sauce run` cooks the file on your Pot, and opening the intent is one of its
steps: in the same transaction, the Pot reads the vault from the Portal (`intentVaultAddress` over
the very bytes it then publishes), transfers each reward token there, sends a native reward, and
calls `publish`, so nothing is published unless the whole cook succeeds, and a token whose transfer
returns `false` reverts it. Values measured while it runs flow into the intent: in
`const amount = USDC.balanceOf(ctx.self())`, `amount` does not exist until the program runs, and
using it inside the braces, in the delivery or in the reward is enough (the package encodes the
intent with a slot for it, and the program writes the value in before it publishes). Any one-word
value can be carried this way.

```sh
sauce run cross-chain.sauce.ts --chain base --keystore <keystore> \
  --intent-deadline <unix seconds> --intent-creator <address> --intent-execution-fee <wei> \
  --args <address>
```

**(c) An intent built elsewhere, from a Pot.** (a) and (b) fund by transfer and publish every intent
a file opens, so an intent written with `Chain(() => …).reward(…)` needs nothing more. This is only
for a route and a reward another tool encoded:
[examples/fund-by-transfer.sauce.ts](examples/fund-by-transfer.sauce.ts) takes them as `publish`'s
three arguments and, in one cook, reads the vault with
`EcoRoutes.Portal.intentVaultAddress(destination, route, reward)`, transfers each reward token
there, calls `EcoRoutes.Portal.publish(destination, route, reward)` and returns
`{ intentHash, vault }`. For an intent file, those three arguments are the arguments of the
`publish` that `sauce intent publish … --from <address> --format json` prints; decode them with its
signature ([references/portal.md](references/portal.md)). The example funds tokens only and refuses
a native reward.

```sh
sauce run fund-by-transfer.sauce.ts --chain base \
  --keystore <keystore> --args <destination> <route> <reward>
```

From a wallet, by hand, it is two transactions: **transfer first, then publish**. If the publish
fails or is never sent, nothing is lost: publish later (the vault still holds the reward), or
`refund` after the deadline. A native reward (`reward.nativeAmount`) is native coin sent to the
vault the same way, by `sauce intent publish` and `sauce run` alike.

**Quoted intents.** A solver that quoted an intent marks its quote funded when it sees
`IntentFunded`, which only `publishAndFund` and `fund` emit. Fund an intent built from a solver's
quote with `--intent-fund-via publishAndFund`, not by transfer: the wallet approves each reward token
to the **Portal** for exactly the reward (a smaller allowance already standing is reset to zero
first, as USDT requires), and `publishAndFund(destination, route, reward, false)` pulls the reward
into the same vault and marks the intent Funded; from a Pot, the same happens inside the cook.

`sauce inspect <file> --chain <chain>` with the same intent flags and `--args` prints each intent the
file opens: its destination, hashes, the route's calls and the reward, every measured value named.

## The lifecycle

1. **Fund.** The reward goes into the intent's vault:
   `Portal.intentVaultAddress(destination, route, reward)` returns it, and tokens sent there count.
2. **Publish.** `Portal.publish` records the intent and emits `IntentPublished`, which solvers
   watch. It needs no funding and anyone may send it; sending it again re-emits the event.
3. **Discover and check.** A solver picks the intent up from `IntentPublished` (or, for an intent it
   quoted, from `IntentFunded`) and calls `Portal.isIntentFunded(destination, route, reward)`: true
   when the status is Funded **or** the vault already holds the whole reward. A solver that finds it
   unfunded may retry for a while, then drop it: fund before or with the publication.
4. **Fill.** On the destination the solver calls the destination Portal's `fulfill`, sending the
   route's `nativeAmount` as value and delivering the route's tokens; the Portal's Executor runs the
   calls. Before the route's deadline, once. `fulfillAndProve` does the same and sends the proof in
   the same transaction, its value the `nativeAmount` plus the prover's fee.
5. **Prove.** The destination Portal's `prove(prover, sourceDomain, intentHashes, data)` hands what it
   recorded (the claimant, or a cancellation) to the destination's prover, which sends it to the
   reward's prover on the source for a fee it quotes (`fetchFee`). With Hyperlane, a relayer
   delivers the message; the source prover then records the claimant, which
   `provenIntents(intentHash)` returns.
6. **Claim.** Once the source has the proof, `withdraw(destination, routeHash, reward)`, sent by
   anyone, pays the vault's reward to the claimant the proof names (`batchWithdraw` claims several).
7. **Refund.** After the reward's deadline, with no proven fill, `refund(destination, routeHash,
reward)`, sent by anyone, returns everything the vault holds of the reward to the creator (the
   creator alone may send `refundTo` to choose another recipient). Before the deadline it reverts
   `InvalidStatusForRefund`. A vault funded but never published refunds the same way.
8. **Cancel, for an earlier refund.** Where the destination Portal has `cancel`, anyone may cancel an
   unfilled intent strictly after the route's deadline: no fill can land after it. Proving the
   cancellation (5) lets the creator refund at once, before the reward's deadline. A cancellation is
   recorded as a claimant no key controls, so the source Portal must refuse to pay it (`withdraw`
   reverting `CancelledIntent`); prove one only to a source Portal that does, and only once the
   cancel is final on the destination (a reorg that let a fill in first would leave that solver
   unpaid).

The Portal's functions, events and errors, with selectors and topics, are in
[references/portal.md](references/portal.md).

## Every step with `sauce intent`

Each verb takes the intent file (with `--chain`, the source, and the flags it was built with) or the
intent's hash, and reads both chains. Every intent the commands publish, fill or import goes into a
local store in your home directory (`--store <dir>` names another), each step recorded from the
Portal's own events as its transaction lands, so later steps name it by hash; where it stands is
read from the chains each time.

```sh
sauce intent publish --keystore <keystore>
sauce intent status <intent-hash>
sauce intent fill <intent-hash> --send --keystore <keystore>
sauce intent prove <intent-hash> --keystore <keystore>
sauce intent claim <intent-hash> --chain <source> --keystore <keystore>
sauce intent refund <intent-hash> --chain <source> --keystore <keystore>
sauce intent cancel <intent-hash> --keystore <keystore>
sauce intent import <tx-hash> --chain <source>
```

| Verb           | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `publish`      | publishes and funds (above)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `status`       | the state on both chains (unfunded, funded, filled, cancelled, proven, cancelProven, claimed, refunded), the deadlines, and whether each next step can be taken now, with why not and from when; an intent funded by a transfer counts as funded, though the Portal's status stays Initial                                                                                                                                                                         |
| `fill`         | without `--send`, simulates the fill on the destination (Simulate both sides); with `--send`, fills it as a solver from the signer: simulated first on the signer's real balances and not sent if it reverts, what it spends shown for approval (`--yes` approves), the approvals sent (zero first where a smaller one stands), then `fulfillAndProve` with the prover's fee, or `fulfill` with `--no-prove`; it prints the Hyperlane message the proof travels as |
| `prove`        | sends the proof of a filled or cancelled intent, paying the prover's fee                                                                                                                                                                                                                                                                                                                                                                                           |
| `claim`        | pays the reward once the source has the proof, and says so, with the message's id, while it has not                                                                                                                                                                                                                                                                                                                                                                |
| `refund`       | returns the reward when the Portal allows it, and says from when otherwise                                                                                                                                                                                                                                                                                                                                                                                         |
| `cancel`       | cancels after the route's deadline, refusing where either Portal lacks the cancellation support above                                                                                                                                                                                                                                                                                                                                                              |
| `import`       | records an intent from its publishing transaction, such as a cascade's later level                                                                                                                                                                                                                                                                                                                                                                                 |
| `list`, `show` | the store, and one intent with its events (`sauce intent show <intent-hash>`)                                                                                                                                                                                                                                                                                                                                                                                      |

- **Without a signer**, each prints its transactions unsigned, for a wallet to send in order; signed
  by any signer, `sauce send <signed>…` (the tool `sauce_send`) broadcasts them in order, reports
  each, and records in the store what each did.
- **`sauce intent` alone**, at a terminal, lists the stored intents with where each stands and runs
  these on the one picked.
- **Over MCP**, the server over stdio keeps the same store: its intent tools take `intentHash`, and
  `sauce_intent_list` and `sauce_intent_show` read it.

### An intent to Solana

An intent Ethereum or Base publishes for Solana is written as any intent, `Solana(() => { ... })`
in `main`, and published from the EVM chain; it is filled, proven and cancelled on Solana, through
its Portal program, and claimed or refunded on its source as above:

```sh
sauce intent publish <file> --chain ethereum --keystore <path> --intent-deadline <unix seconds> \
  --intent-creator <address> --args <solana wallet> <amount> <reward>
sauce intent import <tx-hash> --chain <source>
sauce intent fill <intent-hash> --solver <solana-key> --claimant <address>
sauce intent fill <intent-hash> --claimant <address> --send --keypair <keypair>
sauce intent cancel <intent-hash> --keypair <keypair>
```

- A body of `USDC.transfer(recipient, amount)` pays Solana wallets: the route creates each
  wallet's associated token account where it has none (the rent rides in the route's native
  amount), then transfers from the Portal executor's account. `approve` is refused there.
- `recipient: Address` takes a Solana wallet in base58 on `--args`; a 32-byte `0x` key written in
  the file works too. A token is a mint the registry records (a symbol, or its mint's address).
- Every amount inside the braces is fixed when the intent is built: a literal, a `main` argument
  or a top-level `const`. A value measured while the program runs is refused, by name.
- Any other body is a Solana program, cooked through the Kitchen on the Pot the Portal's executor
  owns; the route creates that Pot when it is missing, and the delivery (the intent's second
  argument) is moved into it first. Its bytecode rides in the solver's one fill transaction
  (1,232 bytes); a fill too large as it is takes its accounts through an address lookup table the
  solver creates first (`sauce intent fill` does, with `--send`), and the command refuses an
  intent whose fill would not fit even then: keep such a program small.
- The command reads Solana before building (which token accounts and Pot exist; with
  `--intent-execution-fee auto`, the Kitchen's fee in lamports), so it needs Solana's endpoint for
  a program body. Two program intents published before the Pot exists race: only the first filled
  creates it, and the other is refunded after its deadline.
- With no file, `sauce intent publish --destination solana --recipient <solana wallet> …` writes
  the transfer intent itself.
- `--claimant` is required on a fill: the address on the source chain the reward pays. A Solana key
  is not one.
- The simulation runs on the solver's accounts as they are, since Solana's simulation takes no
  overrides: the solver must hold the route's tokens.
- `fill --send` sends the fill, then the proof through the HyperProver, with Hyperlane's gas paid in
  the same transaction. Each spend is approved.
- `prove` and `cancel` sign with `--keypair`, which pays their fee. A cancellation's proof waits
  until the slot that cancelled it is finalized.

### An intent from Solana

The same intent file publishes from Solana with `--chain solana`: Solana's Portal escrows the
reward in the intent's vault, a key it derives from the intent's hash, and pays it out on Solana
once the destination's proof arrives.

```sh
sauce intent publish <file> --chain solana --keypair <keypair> \
  --intent-deadline <unix seconds> --intent-creator <solana-key> --args <recipient>
sauce intent fill <intent-hash> --claimant <solana-key> --send --keystore <keystore>
sauce intent claim <intent-hash> --keypair <keypair>
sauce intent refund <intent-hash> --keypair <keypair>
sauce intent import <signature> --chain solana
```

- `publish` sends two transactions per intent from the signer: `fund` (the reward into the vault;
  it fails unless the whole reward arrives), then `publish` (the announcement). A `publish` that
  fails after its `fund` leaves the reward in the vault, refundable after the reward's deadline.
  `--format json` prints them unsigned for `--from <solana-key>`.
- The route travels whole in one Solana transaction: a body of token transfers fits, a program body
  does not.
- The fill, proof and cancellation are the EVM destination's, as for any intent; `--claimant` is
  required there, the Solana key the reward pays (an EVM address is refused). The proof travels to
  Solana's HyperProver, which takes it from the EVM HyperProver.
- `claim` and `refund` are Solana transactions any key may pay for (`--keypair`): the claimant, or
  the creator, is paid, its token account opened first where it has none.
- Over MCP, `sauce_intent_publish` with `chain` `solana` takes `from` (the key that funds the
  reward and pays the fees); `sauce_intent_claim` and `sauce_intent_refund` take `from` (any fee
  payer).

## Cascades

An intent's body can open the next one. Each level's amounts are measured at that level's own
execution and carried into the level below; no amount past the first exists when the user signs.

```sauce chain=base
function main(recipient: Address) {
  const amount = USDC.balanceOf(ctx.self());
  Ethereum(
    () => {
      const arrived = USDC.balanceOf(ctx.self()); // Ethereum's USDC
      Base(() => {
        USDC.transfer(recipient, arrived); // Base's USDC
      }).reward({ tokens: [{ token: USDC, amount: arrived }] }); // Ethereum's: it funds this level
    },
    { tokens: [{ token: USDC, amount }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}
```

- **Each level is a separate fulfilment** by a solver, later, on its own chain: a failure on a later
  hop does not undo an earlier one.
- **The child is published and funded by the parent's body**, as (b): when the Ethereum level runs,
  the shared Pot there pays the next level's reward into its vault on Ethereum's Portal, in
  Ethereum's USDC, and calls `publish`, so any solver can discover it.
- **Every level takes the same** `--intent-deadline`, `--intent-reward-deadline`,
  `--intent-creator` and `--intent-execution-fee`; a `.reward(...)` sets only `tokens` and
  `nativeAmount`. A later level has whatever time the earlier ones leave before that one deadline,
  the creator reclaims each level's unearned reward on the chain that escrowed it, and one fee pays
  every program body's cook (`--intent-execution-fee auto` refuses when those Kitchens charge
  different fees). The Portal and the prover are looked up per level, for its own two chains.
- **A lower level's hash exists only once the level above has run**: import it from that fill's
  transaction (`sauce intent import <tx hash> --chain <chain>`), then fill, prove and claim it like
  any other. (The TypeScript builder, `.nest()` in `sauce-typescript`, takes options per level.)

## The destination side

- **The shared Pot** is the destination Portal Executor's Pot (its owner the Executor, its salt
  zero); the destination's file in `sauce-chains` gives the Executor, and the deployments file the
  Pot. **It must exist before any fill**: until it does, every fulfilment of a program body reverts
  (`CallToEOA`). `sauce intent fill` says whether it is deployed, and puts its deployment first,
  in the simulation and in what `--send` sends, when it is not (any signer may send it; the Pot is
  the Executor's either way). By hand, `sauce pot --chain <destination> --owner <Executor>` prints
  its address and deploy transaction, and with `--deploy --keystore <keystore>` sends it.
  `sauce compile` and `sauce intent publish` warn while it is not deployed on a destination: no
  solver can fill a program body there until it is.
- **Anything left in the shared Pot** after the program, token or allowance, belongs to the next
  intent through that Portal: approve exactly what is spent and move every remainder out.
- **What the solver pays.** The Kitchen fee becomes the route's `nativeAmount`: the solver sends it,
  in the destination's native coin, as the value of `fulfill`, and pays the destination gas too.
  Nothing in the reward pays either back, so the margin (the reward minus what the solver delivers)
  must cover both; a body that reads and swaps on many pools costs a lot of gas, so measure it in a
  simulation. Solvers apply checks of their own and decide which routes they fill.
- **Refunds of unsold input land on the destination**, where the body runs.

## Simulate both sides

- **The source side**: `sauce intent publish --dry-run --assume-balance …` simulates the transfers
  into the vault and `publish`; `sauce simulate` does the same for a file run from a Pot.
- **The fill, on the destination**, where a swap misses its minimum or a refund fails: simulate it
  with `sauce intent fill`, the same file and flags, before publishing. It signs nothing and sends
  nothing:

```sh
sauce intent fill swap-on-base.sauce.ts --chain <chain> \
  --intent-deadline <unix seconds> --intent-creator <address> \
  --intent-execution-fee <Base Kitchen fee in wei> --args-json <args.json>
```

On each intent's destination it runs, in one simulated block, what a solver sends: the shared Pot's
deployment when the body cooks on it and nobody has deployed it yet, the solver's approval of the
destination Portal for the delivered tokens, then `Portal.fulfillAndProve` with the Kitchen's fee and
the prover's fee as its value (or `Portal.fulfill` with the Kitchen's fee alone, with `--no-prove`
or a prover it does not drive). The solver is given the delivered tokens for the simulation only. It
prints each transfer, each address's net change (an address one of `main`'s arguments holds is named
by it) and what the shared Pot and the Executor were left holding, which must be nothing; or why the
fill reverts, down to the body's own `require` message. It warns when the shared Pot is not
deployed, and when `--intent-execution-fee` is below the destination Kitchen's fee. It reads the
destination chain (`--rpc-url` works when every intent goes to one chain, and is then that chain's).
An intent that uses a value measured on chain cannot be simulated this way: its route exists only
once the program runs.

- **The body alone, as a program**: put the body (what is inside the braces) in a file of its own, in
  a `main` taking the parameters it reads, and simulate it for the destination with the delivered
  tokens assumed in the Pot. It runs on your Pot instead of the shared one, but executes the same
  calls, shows what moves, and gives the gas:

```sh
sauce simulate one-pool-body.sauce.ts --chain base --owner <address> \
  --assume-balance WETH:0.001 \
  --args 1000000000000000 <sqrtPriceX96> <amount> <address> <address>
```

- **The fill by hand**, as a solver sends it, on a fork of the destination
  (`anvil --fork-url <destination endpoint>`), with any client:
  1. Get the intent: `sauce inspect <file> --chain <source> --json`, with the same intent flags and
     `--args`, prints each intent's `intentHash`, `routeHash`, `rewardHash`, route and reward; the
     raw route bytes are the `route` argument of the `publish` that
     `sauce intent publish <file> … --from <address> --format json` prints (their keccak-256 is
     `routeHash`).
  2. Make sure the shared Pot exists (The destination side).
  3. Hold the route's `tokens` in an account and approve the **destination** Portal for each;
     `fulfill` pulls them from the sender.
  4. From that account, call the destination Portal's
     `fulfill(bytes32 intentHash, Route route, bytes32 rewardHash, bytes32 claimant)` with **value =
     the route's `nativeAmount`**, the route decoded from its bytes and the claimant the solver's
     address as 32 bytes. Less value reverts `InsufficientNativeAmount(sent, required)`, a missing
     Pot `CallToEOA(<Pot>)`, and a body that reverts surfaces as the Executor's `CallFailed`, with
     the body's own reason inside.
  5. Read the outcome: what the recipient got, what was refunded, the gas, and that the Pot holds
     nothing.

## Pitfalls

- **Promising a fill.** An intent is offered; a solver decides.
- **A reward no bigger than the delivery.** The margin must cover the Kitchen fee and the
  destination gas the solver pays.
- **Publishing before funding.** Fund the vault first, or with `publishAndFund`; a solver that finds
  it unfunded drops it.
- **A token in the reward named through a computed `const`.** Use a symbol, a literal, a top-level
  `const` of a literal, or a `main` argument.
- **A leftover on the shared Pot.** It belongs to the next intent: move every remainder out.
- **A program body with no delivery.** Its balance reads see what is there, not what must be
  brought: give the delivery as the second argument.
- **`ctx.msgSender()` as the user in a body.** In a body it is not the user: take the wallet as a
  `main` parameter.
- **A changed deadline or fee after printing a transaction.** It is a different intent: rebuild.
- **A cascade level on a preview chain.** Later levels are not checked; keep them on supported
  chains.
- **A program running on Solana opening an intent.** Its compile refuses one, naming
  `sauce intent publish`: from Solana a wallet publishes it.

## Files

- [examples/cross-chain.sauce.ts](examples/cross-chain.sauce.ts) forwards the Pot's USDC to Aave on
  Ethereum. It measures its amount, so it runs from a Pot.
- [examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the distributed swap as the
  body of an intent to Base, opened from Ethereum. Its amounts are `main`'s arguments, none
  measured, so it runs from a Pot or is published from a wallet with the same `--args`.
- [examples/fund-by-transfer.sauce.ts](examples/fund-by-transfer.sauce.ts) publishes an intent built
  elsewhere from a Pot, funded by a transfer into its vault, in one cook.
- [examples/intents.mts](examples/intents.mts) compiles the intent files, with the deadline, the
  creator, Base's and Ethereum's fees and the recipient as developer inputs, and pins on which chain
  each name resolves, the fee requirement, the token-only case, the pool ABI's selectors, the
  Portal reference's selectors and topics, and the simulation's transactions.
- [references/portal.md](references/portal.md): the Portal's functions, events and errors, with
  selectors and topics.
