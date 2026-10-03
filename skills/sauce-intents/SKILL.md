---
name: sauce-intents
description: Cross-chain intents written in Sauce — a file that opens the intent, Base.Portal.send(reward).receive(delivery).then(() => { ... }) in main, its inputs main's parameters passed with --args; the deadlines, creator, prover, salt and Kitchen fee as chained modifiers, and their defaults; how an intent is published, funded, discovered, filled, proven, claimed, cancelled and refunded (a sauce intent command each; the intent hash, the vault, isIntentFunded); every way to publish and fund it (sauce intent publish from a wallet, sauce run from a Pot, a transfer into the vault then publish, cascades, quoted intents); amounts measured on chain; token-only bodies versus program bodies; on which chain each name resolves; the shared destination Pot and the Kitchen fee the solver pays; rehearsing both sides. Use when a program should continue on another chain, forward a swap or bridge output, build a cascade, pay a solver, or when the user mentions intents, rewards, vaults, solvers, Portals, provers or Executors.
---

# Cross-chain intents in Sauce

An intent is an **offer**: run this on the destination chain, and the reward escrowed on this chain
is yours. An intent file is a program like any other. `<Chain>.Portal` opens an intent to that chain
in three steps: `.send(...)` names the reward this chain escrows, `.receive(...)` what the solver
delivers on the destination, and `.then(() => { ... })` the body that runs there. Every value the
file does not compute is one of `main`'s typed parameters, passed with `--args` (`sauce-script`).

```sauce chain=base
function main(recipient: Address, amount: Uint256, reward: Uint256, refundTo: Address) {
  Ethereum.Portal.send({ token: USDC, amount: reward }) // Base's USDC, escrowed here
    .refundee(refundTo) // the refund address: an unfilled intent's reward goes back there
    .receive({ token: USDC, amount }) // Ethereum's USDC, brought by the solver
    .then(() => {
      USDC.transfer(recipient, amount); // Ethereum's USDC: the body runs there
    });
}
```

`.refundee(...)` names the **refund address**, where an unfilled intent's reward goes back. Every
intent a program opens names it, at any depth: the Pot a program runs on may be shared, so a
refund there could go to anyone, and nothing defaults it. The deadlines, the prover, the salt and
the destination Kitchen's fee have defaults, and each has a modifier to set it (below).

`.send(...)` and `.receive(...)` take each item as an argument, `{ token, amount }` and, in the
reward only, `{ native: amount }`: `.send({ token: USDC, amount }, { native: 1000000 })`. One list
of items is read the same way. `.receive(...)` is required, even when nothing is delivered:
`.receive()`.

Nothing about the fill is guaranteed: a solver decides whether the reward is worth it, and the
package prices nothing. Say an intent is _offered_, never that it _will execute_.

## Supported chains

For the initial release, intents are published, and every step of their life sent, only between
**Ethereum, Base and Solana**, the chains Sauce supports transactions on. Every other chain in the
registry is a **preview chain**: an intent that involves one still compiles, `sauce inspect` lists
it, and `sauce intent publish --dry-run` and `sauce intent fill` without `--send` rehearse it, but
the `sauce` command and its MCP server build and send none of its transactions. They refuse before
anything is built, signed or sent:

- **Publishing** — `sauce intent publish` (sent, or printed with `--format`), and `sauce run` or
  `sauce tx` of a file that opens the intent — is refused unless the source and every destination
  it opens are supported. The later levels of a cascade are not checked: keep every level on a
  supported chain.
- **Each later step** is refused by the chain it is sent on: `fill --send`, `prove` and `cancel` by
  the destination; `claim` and `refund` by the source.

The refusal names the supported chains and links the request for that chain (an MCP tool returns it
as `refused`, with the issue's title, body and a comment to post). To ask for a chain, find its
request among the existing ones
(https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support) and add the use case
as a comment, or open one from the form
(https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml): the chain and its id,
what you want to run there, the protocols and tokens it needs, and the volume expected and when.

## The lifecycle

An intent is three values: the **destination** chain, the **route** (what runs there: a salt, the
route's deadline, the destination Portal, `nativeAmount`, the tokens the solver delivers, and the
calls) and the **reward** (its deadline, the creator, the prover, a native amount and tokens). Its
hash is `keccak256(abi.encodePacked(uint64 destination, keccak256(route bytes), keccak256(abi.encode(reward))))`,
so every field is in it: the deadlines and the destination Kitchen's fee (the route's
`nativeAmount`) too. **Changing any of them is a different intent**: rebuild every transaction,
including any unsigned one printed earlier.

1. **Fund.** The reward sits in the intent's own **vault** on the source chain. Its address follows
   from the intent hash, so it exists before anything is published or deployed:
   `Portal.intentVaultAddress(destination, route, reward)` returns it, and tokens sent there count.
2. **Publish.** `Portal.publish` records the intent and emits `IntentPublished`, which solvers
   watch. It needs no funding and anyone may send it; sending it again re-emits the event.
3. **Discover and check.** A solver picks the intent up from `IntentPublished` (or, for an intent
   it quoted, from `IntentFunded`) and calls `Portal.isIntentFunded(destination, route, reward)`:
   true when the intent's status is Funded **or** the vault already holds the whole reward. A
   solver that finds it unfunded may retry for a while, then drop it: fund before or with the
   publication.
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

## Deadlines, refundee, prover, salt and fee

Each is a modifier on the step it belongs to. After `.send(...)`, the reward's: `.refundee(address)`,
the refund address, who may reclaim an unearned reward (never a Pot); `.deadline(t)`, from when it
may be refunded; and `.prover(address)`. After `.receive(...)`, the route's: `.deadline(t)`, the last second the intent
may be filled; `.salt(s)`; and `.fee(wei)`, the destination Kitchen's fee a program body pays its
cook. Each is optional and given at most once per step, in any order; `.then(...)` ends the intent
and is required. Deadlines are Unix seconds.

```sauce chain=base
function main(recipient: Address, amount: Uint256, reward: Uint256, refundTo: Address) {
  Ethereum.Portal.send({ token: USDC, amount: reward })
    .refundee(refundTo) // may reclaim the reward if no fill is proven
    .deadline(ctx.timestamp() + 86400 * 14) // refundable after two weeks
    .receive({ token: USDC, amount })
    .deadline(ctx.timestamp() + 1800) // filled within half an hour, or never
    .then(() => {
      USDC.transfer(recipient, amount);
    });
}
```

Left out, each is what Eco's Portal app gives an intent: the fill deadline 5 minutes after the
intent opens and the reward's 7 days after that, the prover the registry records on both chains, a
random salt, and the fee the destination's Kitchen charges, read from it when the intent is built.
The refundee is the exception: a program names it for every intent it opens, at any depth, and
only a top-level intent a wallet publishes itself (`sauce intent publish`) takes that wallet when
it names none. [references/defaults.md](references/defaults.md) has the table.

`.refundee(a)` sets the reward's `creator`: after the deadline a refund goes to `a`, and only `a`
may send the Portal's `refundTo` to redirect it.

- **A value the program computes** works in a deadline, the refundee, the prover and the salt, as it
  does in an amount: `ctx.timestamp() + 1800` is read when the program opening the intent runs, so
  such a file is run from a Pot (`sauce run`), not published from a wallet. A literal, a top-level
  `const` of one or one of `main`'s arguments works everywhere.
- **The fee is known when the intent is built**: a literal or a top-level `const` of one (published
  from a wallet, also one of `main`'s arguments), never a value the program computes. Leave it out
  and the command reads the Kitchen's fee itself.
- **The `sauce` command's flags** set the same for every intent a file opens that does not set it
  itself: `--intent-deadline`, `--intent-reward-deadline`, `--intent-prover`, `--intent-salt`,
  `--intent-execution-fee`. `--intent-refundee` names the refundee only of a top-level intent a wallet
  publishes, in place of that wallet; it is never the refundee of one a program opens.
- **Each run is a new intent.** A default deadline counts from when each command builds the intent,
  and each command picks a fresh random salt, so `sauce inspect`, `sauce intent fill` and
  `sauce intent publish` build three intents with three hashes. To rehearse the intent you publish,
  give every command the same `--intent-deadline` and `--intent-salt <32 bytes of hex>` (or write
  `.deadline(t)` and `.salt(s)` in the file).

## Every step from the command line

`sauce intent` drives the whole lifecycle. Each verb takes the intent file (with `--chain`, the
source, and the flags it was built with) or the intent's hash, and reads both chains. Every intent
the commands publish, fill or import goes into a local
store in your home directory (`--store <dir>` names another), so later steps name it by hash; where it
stands is read from the chains each time.

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

- `publish` with no file asks, at a terminal, for the chains, the token and amount delivered and
  to whom, the reward (suggested: what is delivered plus a margin over the solver's destination
  costs), the deadlines, the prover and how the reward is funded (a transfer to the vault by
  default), writes the intent as a `.sauce.ts` file, rehearses publishing and filling it, and
  publishes it once approved. Each question has a flag (`--source`, `--destination`, `--token`,
  `--amount`, `--recipient`, `--reward-token`, `--reward`, `--prover`, `--fill-deadline`,
  `--reward-deadline`, `--intent-fund-via`), so it runs without a terminal.
- `status` prints the intent's state on both chains (unfunded, funded, filled, cancelled, proven,
  cancelProven, claimed, refunded), its deadlines, and whether each next step can be taken now,
  with why not and from when. An intent funded by a transfer into its vault counts as funded,
  though the Portal's status for it stays Initial.
- `fill --send` fills it as a solver, from the signer: rehearsed first on the signer's real
  balances and not sent if it reverts, and what it spends (each delivered token, and the value)
  shown for approval (`--auto-approve` approves). It sends the approvals (zero first where a smaller one
  stands), then `fulfillAndProve` with the prover's fee, or `fulfill` with `--no-prove`. It prints
  the Hyperlane message the proof travels as.
- `prove` sends the proof of a filled or cancelled intent, paying the prover's fee; `claim` pays the
  reward once the source has the proof, and says so, with the message's id, while it has not;
  `refund` returns the reward when the Portal allows it, and says from when otherwise; `cancel`
  cancels after the route's deadline, refusing where either Portal lacks the cancellation support
  described above.
- Without a signer, each prints its transactions unsigned, for a wallet to send in order.
- `sauce intent` alone, at a terminal, lists the stored intents with where each stands, and runs
  these on the one picked.

**An intent to Solana.** An intent Ethereum or Base publishes for Solana is filled, proven and
cancelled on Solana, through its Portal program, and claimed or refunded on its source as above.

```sh
sauce intent import <tx-hash> --chain <source>
sauce intent fill <intent-hash> --solver <solana-key> --claimant <address>
sauce intent fill <intent-hash> --claimant <address> --send --keypair <keypair>
sauce intent cancel <intent-hash> --keypair <keypair>
```

- `--claimant` is required: the address on the source chain the reward pays. A Solana key is not
  one.
- The rehearsal runs on the solver's accounts as they are, since Solana's simulation takes no
  overrides: the solver must hold the route's tokens.
- `fill --send` sends the fill, then the proof through the HyperProver, with Hyperlane's gas paid in
  the same transaction. Each spend is approved.
- `prove` and `cancel` sign with `--keypair`, which pays their fee. A cancellation's proof waits
  until the slot that cancelled it is finalized.

The Portal's functions, events and errors, with selectors and topics, are in
[references/portal.md](references/portal.md).

## Names resolve per chain

The file is compiled for the **source** chain, the one that pays the reward (`--chain`).

- **In `.send(...)` and its modifiers**, names are the source chain's, which funds and escrows the
  reward: `USDC` there is the source chain's USDC. A reward token must be known when the file is
  compiled: a symbol, or a token's address on the source chain as a literal, a top-level `const` of
  a literal, or, published from a wallet, one of `main`'s arguments. Its amount may be a measured
  value. The route's modifiers are computed on the source chain too, where the intent is built.
- **In `.receive(...)` and inside the body**, the code runs on the destination, and every name a
  chain supplies resolves there: in an `Ethereum.Portal` intent, `USDC` is Ethereum's USDC,
  `AaveV3.Pool` is Ethereum's pool, and `chainId` and a `Namespace_Contract` name are Ethereum's.
  The tokens a destination has are listed in
  [../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md), with their
  addresses in the destination's file in `sauce-chains`
  ([../sauce-chains/references/ethereum.md](../sauce-chains/references/ethereum.md) for Ethereum).
- **The rule repeats at every depth.** An intent opened inside a body is funded on that body's
  chain, so its reward resolves there and its own body on its own destination.
- **Name a token by a symbol, a literal or a top-level `const` of a literal.** Any other
  top-level `const` holding a token's address (`const TOKEN = USDC;`), used in the reward or the
  delivery, counts as a value the program computes, so the compile refuses the intent, saying the
  token's address must be known when the intent is built, and so does `sauce intent publish`. A
  `const` inside the braces is fine.
- A literal address means that address everywhere, and so does one of `main`'s arguments.

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

**(a) From a wallet.** `sauce intent publish` builds each intent before anything runs, so every amount
must be a literal or one of `main`'s arguments, which it binds into the intents as given (each one
word: an integer, an address or a bool), and the file may do nothing but open intents (a file with
an amount measured or computed on chain is refused, with `sauce run` named instead). For each intent it computes the vault from the
Portal's address and the intent and, with an endpoint, reads it from the Portal's
`intentVaultAddress`: the two must agree, or nothing is sent. The wallet then transfers each reward
token to the vault (and sends a native reward to it), only what the vault does not hold yet, and
calls `publish(destination, route, reward)` once the Portal reports the intent funded. A token whose
transfer returns `false` stops it there, before the intent is published, with what was paid still
in the vault: top it up and run it again, or `refund` after the deadline. A second run that finds
the vault funded only publishes. A top-level intent that names no refundee takes the wallet (or
`--intent-refundee`); one a body opens names its own. The deadlines left to their defaults run from
when the command builds the intent.

```sh
sauce intent publish pay-on-ethereum.sauce.ts --chain base \
  --from <address> --dry-run --assume-balance USDC:2 --args <address> 1000000 1100000 <address>
sauce intent publish pay-on-ethereum.sauce.ts --chain base --from <address> --format json \
  --args <address> 1000000 1100000 <address>
```

- `--dry-run` rehearses the transfers and `publish` together from the wallet, then reports what
  `isIntentFunded` returns after them, and sends nothing; `--assume-balance USDC:1` (whole tokens)
  gives the wallet the reward for the rehearsal only, so a wallet that does not hold it yet can
  rehearse. Without `--dry-run`, `--keystore <keystore>` in place of `--from` signs and sends them.
- `--format json` (or `cast`) with `--from` and no signer prints the transactions, unsigned, for that
  wallet to send in order, transfers first, with each intent's `vault`. The vault is also read
  from the Portal and only what it does not hold yet is transferred (with `--offline`, the vault is
  the package's own computation and each transfer is for the whole reward). Send `publish`
  only once the transfers have landed.

**(b) From a Pot.** `sauce run` cooks the file on your Pot, and opening the intent is one of its
steps: in the same transaction as everything else, the Pot reads the intent's vault from the Portal
(`intentVaultAddress` over the very bytes it then publishes), transfers each reward token there,
sends a native reward, and calls `publish`, so nothing is published unless the whole cook succeeds,
and a token whose transfer returns `false` reverts it. Values measured while it runs can flow into the intent: in
`const amount = USDC.balanceOf(ctx.self())`, `amount` does not exist until the program runs, and
using it inside the body, in the delivery, in the reward or in a modifier is enough. The package
encodes the intent with a slot for it, and the program writes the measured value in before it
publishes. Any one-word value can be carried this way. Every intent the file opens names its
refundee: nothing defaults it to the Pot or its owner. The command reads each destination Kitchen's
fee for a body that is a program.

```sh
sauce run cross-chain.sauce.ts --chain base --keystore <keystore> --args <address> <address>
```

**(c) An intent built elsewhere, from a Pot.** (a) and (b) fund by transfer and publish every intent
a file opens, so an intent you write with `<Chain>.Portal.send(…)` needs nothing more. This file
is only for an intent you did not write: a route and a reward another tool encoded, published from a
Pot. [examples/fund-by-transfer.sauce.ts](examples/fund-by-transfer.sauce.ts) takes them as
`publish`'s three arguments and does in one cook what (b) does: it reads the vault with
`EcoRoutes.Portal.intentVaultAddress(destination, route, reward)`, the registry's Portal on the
chain it runs on, transfers each reward token there, calls
`EcoRoutes.Portal.publish(destination, route, reward)` and returns `{ intentHash, vault }`. For an
intent file, those three arguments are the arguments of the `publish` that
`sauce intent publish … --from <address> --format json` prints; decode them with its signature (in
[references/portal.md](references/portal.md)). An intent from a solver's quote is funded with
`publishAndFund` instead (below).

```sh
sauce run fund-by-transfer.sauce.ts --chain base \
  --keystore <keystore> --args <destination> <route> <reward>
```

- **From a wallet**, it is two transactions: **transfer first, then publish**, so a solver that sees
  `IntentPublished` finds the intent funded. If the publish fails or is never sent, nothing is lost:
  publish later (the vault still holds the reward), or `refund` after the deadline.
- **What the CLI emits**: `sauce intent publish` and `sauce run` fund every intent this way by default, as
  (a) and (b) describe; `--intent-fund-via publishAndFund` gives the approve and `publishAndFund`
  instead.
- A native reward is an item of its own in `.send(...)`, `{ native: amount }` in wei, beside the
  tokens (`.send({ token: USDC, amount }, { native: 1000000000000000 })`): native coin sent to the
  vault the same way, by `sauce intent publish` and `sauce run` alike. The example funds tokens only
  and refuses a native reward.

**Quoted intents.** A solver that quoted an intent marks its quote funded when it sees
`IntentFunded`, which only `publishAndFund` and `fund` emit. For an intent built from a solver's
quote, fund it with `publishAndFund`: (a) or (b) with `--intent-fund-via publishAndFund`, not by
transfer. The wallet then approves each reward token to the **Portal** for exactly the reward (a
smaller allowance already standing is reset to zero first, as USDT requires), and
`publishAndFund(destination, route, reward, false)` pulls the reward into the same vault and marks
the intent Funded; from a Pot, the same happens inside the cook.

`sauce inspect <file> --chain <chain>` with the same intent flags and `--args` prints each intent
the file opens: its destination, hashes, the route's calls and the reward, with every measured value
named.

## Two kinds of body

| The body is…                                                                                          | Lowers to                                                    | Needs                                                                              | Token writes                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| only `transfer`/`approve` calls on a symbol or `Token(address)`, with literal or captured arguments   | plain calls the destination Portal's Executor makes          | nothing more: no Pot, no Kitchen fee                                               | USDT works and `approve` is reset to zero first, but a `false` return is **not** detected |
| anything else: a local, a balance read, a condition, a protocol call, `transferFrom`, a nested intent | a program compiled for the destination and cooked on its Pot | the destination's Kitchen fee, which the command reads unless `.fee(...)` gives it | SafeERC20: a `false` return reverts the fulfilment                                        |

The Executor checks only that each call did not revert, so a token-only body's transfer that
returns `false` fills the intent with nothing moved; a call with data to an address with no code
reverts `CallToEOA`. Either way, `.receive(...)` says what the solver delivers: a balance read in
the body reads what is there, not what must be brought. `.receive()` with no items delivers a
token-only body what its transfers move, and a program body nothing. Here the solver brings on Ethereum what the
Pot holds on Base, less 0.1%:

```sauce chain=base
function main(beneficiary: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  const delivered = amount - (amount * 10) / 10000;
  Ethereum.Portal.send({ token: USDC, amount })
    .refundee(refundTo)
    .receive({ token: USDC, amount: delivered })
    .then(() => {
      USDC.approve(AaveV3.Pool, delivered);
      AaveV3.Pool.supply(USDC, delivered, beneficiary, 0);
    });
}
```

The gap between `delivered` (brought on Ethereum) and `amount` (paid on Base) is the solver's
margin. Make it worth filling.

## A whole program as the body

The body can be any program for the destination. It is written inside the braces and uses
`main`'s parameters as values. It may also use what the file declares: its imports (an ABI, a library)
and its helper functions, each compiled into the body's program for the destination. It calls
contracts as any program does (`sauce-script`): by namespace (`UniswapV3.Factory.getPool(...)`),
through a registry ABI import, or through an ABI of the file's own imported at its top. A swap is a
`@sauce/router`
call (`sauce-swaps`), imported at the top of the file. Every unsold input and every output leaves the destination Pot
before the body ends, and a refund the body makes lands on the destination chain. On a
destination the Pot is shared by every intent, so a body moves only amounts it can account for —
what its intent delivered, what a `@sauce/router` function returns, or a balance's change across one
step — never the Pot's whole balance: a refund returns what this intent delivered and did not use.

A one-pool swap, with the guard every swap needs (`sauce-swaps`): WETH a solver delivers on Base is
sold on the Uniswap V3 0.05% pool down to `sqrtPriceLimitX96`, at least `minOut` USDC goes to
`recipient`, and any unsold WETH to `refundTo`, on Base, which is also where an unfilled intent's
reward is refunded on Ethereum. A fill below `minOut` reverts the whole
fulfilment, so set it from the limit (`sauce-distributed-swap` has the recipe), never above what the
pool can pay.

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
  Base.Portal.send({ token: WETH, amount: reward }) // the source chain's WETH
    .refundee(refundTo)
    .receive({ token: WETH, amount: amountIn }) // Base's WETH
    .then(() => {
      const pool = UniswapV3.Factory.getPool(WETH, USDC, 500); // Base's 0.05% tier
      require(pool != 0, "no WETH/USDC pool at 0.05%");
      // Pays the recipient the USDC, and reverts the whole fulfilment below minOut.
      const before = WETH.balanceOf(ctx.self());
      uniswapV3(pool, WETH, USDC, amountIn, sqrtPriceLimitX96, minOut, recipient);
      // What this intent delivered and the pool did not take: never the shared Pot's balance.
      const unsold = amountIn - (before - WETH.balanceOf(ctx.self()));
      if (unsold > 0) {
        WETH.transfer(refundTo, unsold);
      }
    });
}
```

`reward` must exceed what the solver delivers, `amountIn`, by what filling costs it (below). To buy
WETH instead, swap `USDC` for `WETH` and deliver USDC: USDC is token1 on Base, so the limit is then
a ceiling, the `buy` block of `sauce price`.
[examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the same with a distributed
swap as the body (`sauce-distributed-swap`): one pass over every Uniswap V3 and hookless V4 pool of
the pair, each offered the WETH still unsold up to its own fee-adjusted limit, and skipped when it
has no liquidity or is past that limit. It swaps through `@sauce/router`, finds each V3 pool with
`UniswapV3.Factory.getPool` and reads it as `UniswapV3.Pool(pool)`, and reads the V4 pools from
`UniswapV4.StateView`.

## When the body reverts

A body that reverts fails the fill: the solver's transaction reverts, and the reward stays
escrowed until it is refunded. On an EVM destination, `.catch(...)` after `.then(...)` handles the
body instead. When the body reverts, everything it did is undone, the handler runs on the
destination in its place, and the fill succeeds. Here a supply that fails hands the delivered USDC
to the beneficiary:

```sauce chain=base
function main(beneficiary: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  Ethereum.Portal.send({ token: USDC, amount })
    .refundee(refundTo)
    .receive({ token: USDC, amount })
    .then(() => {
      USDC.approve(AaveV3.Pool, amount);
      AaveV3.Pool.supply(USDC, amount, beneficiary, 0);
    })
    .catch((e) => {
      USDC.transfer(beneficiary, amount);
    });
}
```

`e` is what the body reverted with, as `bytes`: at most its first 256 bytes, the error's selector
first (`e.slice(0, 4)`). Write `.catch(() => { … })` when the handler does not read it. A handled
body is always a program, so its cook pays the destination's Kitchen fee.

## Calls around the body

`.before(() => { … })` and `.after(() => { … })`, after `.receive(...)` and among the route's
modifiers, add calls the destination Portal's Executor makes before the body runs and after it. Use
one for a call that must come from the Executor rather than the Pot, and for a call a solver reads
straight off the route, with no program to simulate. Here a referral fee in the delivered USDC is
paid before the supply:

```sauce chain=base
function main(
  beneficiary: Address,
  referrer: Address,
  amount: Uint256,
  fee: Uint256,
  reward: Uint256,
  refundTo: Address,
) {
  Ethereum.Portal.send({ token: USDC, amount: reward })
    .refundee(refundTo)
    .receive({ token: USDC, amount })
    .before(() => {
      USDC.transfer(referrer, fee); // delivered on top of `amount`
    })
    .then(() => {
      USDC.approve(AaveV3.Pool, amount);
      AaveV3.Pool.supply(USDC, amount, beneficiary, 0);
    });
}
```

The route's calls are every `.before(...)`'s, then the body's (the delivery moved into the Pot and
the cook, or a token-only body's own calls), then every `.after(...)`'s, each hook in the order
written; each may be given any number of times. A hook is recorded, never compiled: each statement
is a `transfer` or `approve` on a symbol or `Token(address)`, each argument a literal or a variable
of the program opening the intent, as in a token-only body. Anything else in it (a local, a
computed argument, a read, a protocol call) is refused.

- **The Executor makes the calls**: it is the caller a hook's target sees. One Executor serves every
  intent on a chain, so every `approve` a hook records is reset to zero first.
- **A hook is outside `.catch(...)`**: a hook that reverts reverts the whole fill, and the body's
  handler does not run.
- **Its arguments are fixed when the intent is published**: a variable of the program opening it is
  written in as that program runs, as an amount is; nothing the body computes reaches a hook.
- **It has no access to the Pot's funds**: the body runs in the Pot, a hook on the Executor, so
  `.after(...)` cannot spend what the body holds. What a hook transfers is delivered on top of what
  `.receive(...)` names, which still moves into the Pot whole: the solver above brings
  `amount + fee`.

Hooks are for EVM destinations: on Solana they are refused, since a Solana route call names its
accounts.

## Cascades

An intent's body can open the next one. Each level pays the next solver what it was delivered, so
every amount follows from the first, and each solver keeps its margin (0.1% here).

```sauce chain=base
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self()); // this Pot's own, on Base
  const onEthereum = amount - amount / 1000; // what the first solver delivers
  const onBase = onEthereum - onEthereum / 1000; // what the second delivers
  Ethereum.Portal.send({ token: USDC, amount })
    .refundee(refundTo)
    .receive({ token: USDC, amount: onEthereum })
    .then(() => {
      Base.Portal.send({ token: USDC, amount: onEthereum }) // Ethereum's: what this level received
        .refundee(refundTo) // every level names its own
        .receive({ token: USDC, amount: onBase })
        .then(() => {
          USDC.transfer(recipient, onBase); // Base's USDC
        });
    });
}
```

Each level is a separate fulfilment by a solver, later, on its own chain: a failure on a later hop
does not undo an earlier one. The child is published and funded **by the parent's body**, as (b)
above: when the Ethereum level runs, the shared Pot there pays the next level's reward into its
vault on Ethereum's Portal from what that level was delivered, in Ethereum's USDC, and calls
`publish`, so the child is published like any other intent and any solver can discover it. Keep
every level on a supported chain, as here (Base, Ethereum, then Base again): the command checks the
first level's chains only.

`await` of an intent calls its `then`, as JavaScript's `await` does: `await x; rest` is
`x.then(() => { rest })`. The statements after it are its body, so the same cascade reads top to
bottom. It compiles exactly as the program above:

```sauce chain=base
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  const onEthereum = amount - amount / 1000;
  const onBase = onEthereum - onEthereum / 1000;
  await Ethereum.Portal.send({ token: USDC, amount })
    .refundee(refundTo)
    .receive({ token: USDC, amount: onEthereum });
  await Base.Portal.send({ token: USDC, amount: onEthereum }) // Ethereum's USDC: this runs there
    .refundee(refundTo)
    .receive({ token: USDC, amount: onBase });
  USDC.transfer(recipient, onBase); // Base's USDC
}
```

No `async` is needed. An `await` is a statement directly in `main`'s body, in the body of an
intent, or in a `try` block there. Everything after it, to the end of that body, runs on its
destination: names resolve there, values from before it are captured and cannot be assigned or
declared again, and a `return` is the body's. An `await` inside an `if`, a loop or another block, in
another function, or used as a value is a compile error, and so is `await` followed by `(`, `[` or a
line break in `main` or a body, where it reads as a name: start the intent on the `await`'s line.

A `try` around awaited intents handles each body, and what runs before them. The handler runs on
whichever chain failed and resolves its names there. It is compiled once per chain, and
`chainId == Ethereum` is decided as it is (a chain's name is its id), so each chain keeps only its
own branch, which moves only what that chain can account for:

```sauce chain=base
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  const delivered = amount - amount / 1000;
  try {
    await Ethereum.Portal.send({ token: USDC, amount })
      .refundee(refundTo)
      .receive({ token: USDC, amount: delivered });
    USDC.approve(AaveV3.Pool, delivered);
    AaveV3.Pool.supply(USDC, delivered, recipient, 0);
  } catch (e) {
    if (chainId == Ethereum) {
      USDC.transfer(refundTo, delivered); // what this intent delivered, from the shared Pot
    } else {
      USDC.transfer(refundTo, amount); // on Base, where it opens: this Pot's own
    }
  }
}
```

`try { S1; await a; S2 } catch (e) { H }` is
`try { S1; a.then(() => { S2 }).catch((e) => { H }); } catch (e) { H }`, at every `await` in it.
`chainId` tells chains apart, not hops: a cascade that visits a chain twice runs that chain's branch
on both visits, so the branch must be right for each of them, such as the smaller amount. Nothing
may follow such a `try`, and its handler cannot `await`.

Each level takes its own modifiers, and each it leaves out takes its default for that level:

- **Deadlines** count from when the level opens, which for a level below the first is when the
  body above it runs: its fill deadline is 5 minutes after that, and its reward's 7 days after the
  fill deadline. A deadline flag (`--intent-deadline`, `--intent-reward-deadline`) is the same
  second for every level that sets none, so a later level has whatever time the earlier ones leave.
- **The refundee** has no default at any level: each names its own, here the same `refundTo`, which
  reclaims each level's unearned reward on the chain that escrowed it, so it must be an address its
  owner controls on each of them.
- **The salt** is random for each level, picked as the level above is built.
- **The fee** is each destination Kitchen's own, read for every chain a level's program runs on.
- **The Portal and the prover** are looked up per level, for its own two chains.

The hash of a level below the first exists only once the level above has run: import it from that
fill's transaction (`sauce intent import <tx hash> --chain <chain>`), then fill, prove and claim it
like any other. (The TypeScript builder, `.nest()` in `sauce-typescript`, takes a child per level,
and by default funds it by a transfer into its vault with no publication of its own.)

## What the compile supplies, and what you pass

The Portal, the prover, the destination Pot and the encoding are looked up from the eco-routes
registry, which records each chain's Portal and a prover deployed on both sides. Each chain's file in
`sauce-chains` says whether it takes intents and gives its Portal, Executor and shared intent Pot
([../sauce-chains/references/index.md](../sauce-chains/references/index.md)). Every other value has
a default ([references/defaults.md](references/defaults.md)); two deserve a thought:

- **The fill deadline**, 5 minutes after the intent opens unless `.deadline(t)` after `.receive`
  says otherwise: long enough for a solver that quoted it, short for one that must find and rehearse
  it first.
- **The fee** of a program body: the destination Kitchen's fee is mutable on chain and lives on the
  destination, so the command reads it there when it builds the intent (an `eth_call` of
  `executionFee()` on the destination's Kitchen, whose address is in the chain's file in
  `sauce-chains`). An increase before the fill makes the cook, and the fulfilment, revert: build
  close to sending. With `--offline`, give it with `.fee(wei)` or `--intent-execution-fee <wei>`.

**Units and arguments.** Amounts are base units (`1000000` is 1 USDC); only `--assume-balance`
and `--fund` take whole tokens. In `--args-json`, write an address or any value past 2^53 as a JSON
string (`"1000000000000000000"`): a JSON number loses precision.

Refused at compile time, never silently changed: a name the program does not declare, an intent a
program opens with no `.refundee(...)`, a program body's fee nothing supplies (offline with no
fee), a modifier given twice or after the wrong step, an intent with no `.receive(...)` or
`.then(...)`, a chain with no eco-routes deployment, a pair with no prover deployed on both sides.

## The destination side

- **The shared Pot.** A program body cooks on the destination Portal Executor's **shared Pot** (its
  owner is the Executor, its salt zero); the destination's file in `sauce-chains` gives the Pot and
  the Executor. **The Pot must exist before any fill**: until it does, every fulfilment of a program
  body reverts (`CallToEOA`). `sauce pot --chain <destination> --owner <Executor>` prints its
  address and deploy transaction; with `--deploy --keystore <keystore>`
  any signer deploys it (the Pot is the Executor's either way), and an existing one is reported, not
  redeployed; `sauce intent fill` says whether it is deployed on the destination, and deploys it in its
  rehearsal when it is not. Anything left in the Pot after the program, token or allowance, belongs
  to the next intent through that Portal: approve exactly what is spent and move every remainder
  out.
- **What the solver pays.** The Kitchen fee becomes the route's `nativeAmount`: the solver sends it,
  in the destination's native coin, as the value of `fulfill`, and pays the destination gas too.
  Nothing in the reward pays either back, so the margin (the reward minus what the solver delivers)
  must cover both; a body that reads and swaps on many pools costs a lot of gas, so measure it in a
  rehearsal (below). Solvers apply checks of their own, such as the reward covering the route's
  tokens plus their fee, and decide which routes they fill.
- **Refunds of unsold input land on the destination**, where the body runs.

## Rehearse both sides before a solver does

- **The source side**: `sauce intent publish --dry-run --assume-balance …` (above) rehearses the transfers
  into the vault and `publish`; `sauce simulate` rehearses a file run from a Pot.
- **The fill, on the destination**: the body runs there, when a solver fills the intent, and that is
  where a swap misses its minimum or a refund fails. Rehearse it with `sauce intent fill`, the same file
  and flags, before publishing; it signs nothing and sends nothing:

```sh
sauce intent fill swap-on-base.sauce.ts --chain <chain> \
  --intent-deadline <unix seconds> --args-json <args.json>
```

On each intent's destination it runs, in one simulated block, what a solver sends: the shared
Pot's deployment when the body cooks on it and nobody has deployed it yet, the solver's approval
of the destination Portal for the delivered tokens, then `Portal.fulfillAndProve` with the
Kitchen's fee and the prover's fee as its value (or `Portal.fulfill` with the Kitchen's fee alone,
with `--no-prove` or a prover it does not drive). The solver is given the delivered tokens for the rehearsal only. It prints each
transfer, each address's net change (an address one of `main`'s arguments holds is named by it) and what
the shared Pot and the Executor were left holding, which must be nothing; or why the fill
reverts, down to the body's own `require` message. It warns when the shared Pot is not deployed,
and when the fee given (`.fee(...)` or `--intent-execution-fee`) is below the destination Kitchen's,
naming the fee to pass.
It reads the destination chain (`--rpc-url`, for an endpoint of your own, works when every intent
goes to one chain, and is then that chain's). An intent that uses a value measured on chain
cannot be rehearsed this way: its route exists only once the program runs. Fix what it reports
and rehearse again before `sauce intent publish` or `sauce run`. With `--send` and a signer,
`sauce intent fill` then fills it for real (above).

- **The body alone, as a program**: copy the body (what is inside the braces) into a file of its own,
  in a `main` taking the parameters it reads, and rehearse it as a program for the destination, with
  the delivered tokens assumed in the Pot. It runs on your Pot instead of the shared one, but
  executes the same calls, shows what moves, and gives the gas:

```sh
sauce simulate one-pool-body.sauce.ts --chain base --owner <address> \
  --assume-balance WETH:0.001 \
  --args 1000000000000000 <sqrtPriceX96> <amount> <address> <address>
```

- **The fill by hand**, as a solver sends it, on a fork of the destination
  (`anvil --fork-url <destination endpoint>`), with any client:
  1. Get the intent: `sauce inspect <file> --chain <source> --json`, with the same intent flags and
     `--args`, prints each intent's `intentHash`, `routeHash`, `rewardHash`, route and reward;
     the raw route bytes are the `route` argument of the `publish` that
     `sauce intent publish <file> … --from <address> --format json` prints (their keccak-256 is
     `routeHash`).
  2. Make sure the shared Pot exists (above).
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

Solana destinations are not built this way (see `sauce-solana`). An application can also build an
intent from TypeScript around a program it compiles itself (`sauce-typescript`).

## Examples

- [examples/cross-chain.sauce.ts](examples/cross-chain.sauce.ts) forwards the Pot's USDC to Aave on
  Ethereum. It measures its amount, so it runs from a Pot.
- [examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the distributed swap as the
  body of an intent to Base, opened from Ethereum. Its amounts are `main`'s arguments, none of them
  measured, so it can be run from a Pot or published from a wallet with the same `--args`.
- [examples/fund-by-transfer.sauce.ts](examples/fund-by-transfer.sauce.ts) publishes an intent
  built elsewhere from a Pot, funded by a transfer into its vault, in one cook.
- [examples/intents.mts](examples/intents.mts) compiles the intent files, with the refundee, Base's
  and Ethereum's fees and the recipient as developer inputs, and pins the defaults, the modifiers
  example, on which chain each name resolves, the fee requirement, the token-only case, the pool
  ABI's selectors, and the rehearsal's transactions: the Pot's deploy and `fulfill` with the fee as
  its value.
