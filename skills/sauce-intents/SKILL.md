---
name: sauce-intents
description: Cross-chain intents written in Sauce — a file that hops to another chain, await Base.hop({ reward, receive, refundee }) in main, the code after it running there, its inputs main's parameters passed with --args; the deadlines, refundee, prover, salt and Kitchen fee as fields of the hop, and their defaults; how an intent is published, funded, discovered, filled, proven, claimed, cancelled and refunded (a sauce intent command each; the intent hash, the vault, isIntentFunded); every way to publish and fund it (a cook on your Pot, sauce intent publish --fund or sauce run; a transfer into the vault; cascades; quoted intents); amounts measured on chain; the body, a program cooked on the destination's shared Pot, and the Kitchen fee the solver pays; on which chain each name resolves; rehearsing both sides. Use when a program should continue on another chain, forward a swap or bridge output, build a cascade, pay a solver, or when the user mentions intents, rewards, vaults, solvers, Portals, provers or Executors.
---

# Cross-chain intents in Sauce

An intent is an **offer**: run this on the destination chain, and the reward escrowed on this chain
is yours. An intent file is a program like any other. `await <Chain>.hop({ … })` opens an intent
to that chain: `reward` names what this chain escrows for the solver, `receive` what the solver
delivers on the destination, and everything after the `await` is the body that runs there. Every
value the file does not compute is one of `main`'s typed parameters, passed with `--args`
(`sauce-script`).

```sauce chain=base
function main(recipient: Address, amount: Uint256, reward: Uint256, refundTo: Address) {
  await Ethereum.hop({
    reward: { token: USDC, amount: reward }, // Base's USDC, escrowed here
    receive: { token: USDC, amount }, // Ethereum's USDC, brought by the solver
    refundee: refundTo, // the refund address: an unfilled intent's reward goes back there
  });
  USDC.transfer(recipient, amount); // Ethereum's USDC: from here on, the code runs there
}
```

As in JavaScript, `await x; rest` is `x.then(() => { rest })`. The same intent with its body written
out, the same program:

```sauce chain=base
function main(recipient: Address, amount: Uint256, reward: Uint256, refundTo: Address) {
  Ethereum.hop({
    reward: { token: USDC, amount: reward },
    receive: { token: USDC, amount },
    refundee: refundTo,
  }).then(() => {
    USDC.transfer(recipient, amount);
  });
}
```

`refundee` is the **refund address**, where an unfilled intent's reward goes back. Every hop names
it, at any depth: an intent is published by a program a Pot runs, and the Pot may be shared, so a
refund there could go to anyone, and nothing defaults it, not even the wallet that sends the cook.
The deadlines, the prover, the salt and the destination Kitchen's fee have defaults, and each is a
field of the hop (below).

`reward` and `receive` each take one item or a list of them: `{ token, amount }` and, in the reward
only, `{ native: amount }`: `reward: [{ token: USDC, amount }, { native: 1000000 }]`. `receive` says
exactly what the solver delivers: left out, the solver delivers nothing, and the body has only what
the shared Pot it runs on holds, which is not this intent's to spend.

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

Each is a field of the hop, beside `reward` and `receive`, given at most once and in any order:
`refundee`, the refund address, who may reclaim an unearned reward (never a Pot);
`rewardDeadline`, from when it may be refunded; `prover`; `deadline`, the last second the intent
may be filled; `salt`; and `fee`, the destination Kitchen's fee a program body pays its cook.
Deadlines are Unix seconds.

```sauce chain=base
function main(recipient: Address, amount: Uint256, reward: Uint256, refundTo: Address) {
  await Ethereum.hop({
    reward: { token: USDC, amount: reward },
    receive: { token: USDC, amount },
    refundee: refundTo, // may reclaim the reward if no fill is proven
    rewardDeadline: ctx.timestamp() + 86400 * 14, // refundable after two weeks
    deadline: ctx.timestamp() + 1800, // filled within half an hour, or never
  });
  USDC.transfer(recipient, amount);
}
```

Left out, each is what Eco's Portal app gives an intent: the fill deadline 5 minutes after the
intent opens and the reward's 7 days after that, the prover the registry records on both chains, a
random salt, and the fee the destination's Kitchen charges, read from it when the intent is built.
The refundee is the exception: every intent names it, at any depth.
[references/defaults.md](references/defaults.md) has the table.

`refundee: a` sets the reward's `creator`: after the deadline a refund goes to `a`, and only `a`
may send the Portal's `refundTo` to redirect it. A field the hop does not take is ignored, not
refused, so spell each as written here.

- **A value the program computes** works in a deadline, the refundee, the prover and the salt, as it
  does in an amount: `ctx.timestamp() + 1800` is read when the program opening the intent runs. A
  literal, a top-level `const` of one or one of `main`'s arguments works as well.
- **The fee** may be computed too. Leave it out and the command reads the destination Kitchen's
  fee itself, when it builds the intent.
- **The `sauce` command's flags** set the same for every intent a file opens that does not set it
  itself: `--intent-deadline`, `--intent-reward-deadline`, `--intent-prover`, `--intent-salt`,
  `--intent-execution-fee`. The refundee has no flag: the file names it.
- **Each run is a new intent.** A default deadline counts from when each command builds the intent,
  and each command picks a fresh random salt, so `sauce intent publish --dry-run`,
  `sauce intent fill` and `sauce intent publish` build three intents with three hashes. To
  rehearse the intent you publish, give every command the same `--intent-deadline` and
  `--intent-salt <32 bytes of hex>` (or write `deadline` and `salt` in the hop).

## Every step from the command line

`sauce intent` drives the whole lifecycle. Each verb after publishing takes the intent as it was
published: its hash, or `--tx <hash> --chain <source>`, the transaction that published it. A file
is only a preview (`sauce intent fill <file>` without `--send`): its intents are rebuilt by a
rehearsal with a salt and deadlines of their own. Each verb reads both chains. Every intent
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
  costs, the Kitchen's fee among them), the deadlines, the prover and how the reward is funded (a
  transfer to the vault by default), writes the intent as a `.sauce.ts` file naming you as its
  refundee, rehearses publishing and filling it, and publishes it once approved: a cook on your
  Pot that pulls the reward in from your wallet. Each question has a flag (`--source`, `--destination`, `--token`,
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

- **In `reward` and the other fields**, names are the source chain's, which funds and escrows the
  reward: `USDC` there is the source chain's USDC. A reward token must be known when the file is
  compiled: a symbol, or `Token(<address on the source chain>)`. Its amount may be a measured
  value. The deadlines, salt and fee are computed on the source chain too, where the intent is
  built.
- **In the body**, after the `await` or inside `.then(...)`, the code runs on the destination, and
  every name a chain supplies resolves there: after `await Ethereum.hop(...)`, `USDC` is Ethereum's
  USDC, `AaveV3.Pool` is Ethereum's pool, and `chainId` and a `Namespace_Contract` name are
  Ethereum's. The tokens a destination has are listed in
  [../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md), with their
  addresses in the destination's file in `sauce-chains`
  ([../sauce-chains/references/ethereum.md](../sauce-chains/references/ethereum.md) for Ethereum).
- **The rule repeats at every depth.** A hop opened in a body is funded on that body's chain, so its
  reward resolves there and its own body on its own destination.
- **In `receive` only the tokens are the destination's, each symbol looked up again there by its
  name; every other value in it, an amount included, is computed on the source chain, where the
  intent opens.** So `USDC` delivers the destination's USDC, while `chainId` in an amount is the
  source's. A token only the destination has is named by its symbol all the same
  (`receive: { token: USDT0, amount }` from Base, which has no USDT0, is the destination's USDT0);
  a symbol neither chain has is refused, naming the destination. An address is used as written:
  `Token(<address on the destination>)`. A token in the reward is the source chain's, by symbol or
  by `Token(<address>)`.

## Publishing and funding

Every intent is published by a program: the file, cooked on a Pot. In the same cook the Pot pays
each intent's reward into its vault and publishes it, so nothing is published unless the whole cook
succeeds, and the intent's hash and record are read from the Portal's `IntentPublished` log.

| Way                                     | What runs                                                                                                                            | Emits                             | Choose it when                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------- |
| (a) `sauce intent publish <file>`       | the file cooked on your own Pot, `--fund` pulling the reward in from your wallet, then each intent paid into its vault and published | `IntentPublished`                 | the file opens intents for you to publish                 |
| (b) `sauce run <file>`                  | the same cook: any program, its intents among its other steps                                                                        | `IntentPublished`                 | the intent opens atomically with other steps              |
| (c) Transfer into the vault, from a Pot | a token transfer to `intentVaultAddress(...)`, then `publish`, for an intent you encode yourself                                     | `IntentPublished`                 | the intent was not built from a file the package compiles |
| `--intent-fund-via publishAndFund`      | (a) or (b) with `approve(Portal, reward)` per token, then `publishAndFund`                                                           | `IntentPublished`, `IntentFunded` | an intent built from a solver's quote (below)             |

Funding by transfer needs no approval, so no allowance is left standing and USDT needs nothing
special. The vault counts whatever it holds, so `isIntentFunded` is true from the moment the
transfer lands; the intent's status stays Initial (only `publishAndFund` or `fund` set Funded), and
`isIntentFunded`, the check solvers make, accepts either. The reward always goes into the vault
**before** `publish` is sent, so a solver that sees `IntentPublished` finds the intent funded.

**(a) `sauce intent publish`.** The file runs on your own Pot (`--salt` picks another of yours),
which reads each intent's vault from the Portal (`intentVaultAddress` over the very bytes it then
publishes), transfers each reward token there, sends a native reward, and calls `publish`. A token
whose transfer returns `false` reverts the cook, so no intent is published with an empty vault.
`--fund USDC:1.1` (whole tokens) pulls the reward from your wallet into the Pot in the same cook,
as `sauce run --fund` does (`sauce-cli`); without it the Pot must hold the reward already. A
value measured while the cook runs can flow into the intent: in
`const amount = USDC.balanceOf(ctx.self())`, `amount` is read on your Pot, and using it in the
reward, the delivery, a field or the body is enough. `main`'s arguments are the cook's,
passed with `--args`. The command prints each intent it published, with its hash and record, and
keeps it in its store.

```sh
sauce intent publish pay-on-ethereum.sauce.ts --chain base --from <address> --dry-run \
  --assume-balance USDC:2 --args <address> 1000000 1100000 <address>
sauce intent publish pay-on-ethereum.sauce.ts --chain base --keystore <keystore> \
  --fund USDC:1.1 --args <address> 1000000 1100000 <address>
```

- `--dry-run` rehearses the cook from the Pot's owner (the signer, or `--from` with no key), as
  `sauce simulate` does, and prints each intent it publishes, read from the Portal's log, with
  nothing sent; `--assume-balance USDC:2` (whole tokens) gives the Pot the reward for the rehearsal
  only, and `--fund` with no key credits it what the pull would bring.
- `--format json` (or `cast`) with `--from` and no signer prints the cook, unsigned, as `sauce tx`
  does, for that wallet to send; the Pot must then hold the reward when it lands. Its intents are
  known once it lands: `sauce intent import <tx-hash> --chain <source>` reads them from it.

**(b) `sauce run`.** The same cook for any program: opening the intent is one of its steps, beside
whatever else the program does. Every intent the file opens names its refundee: nothing defaults it
to the Pot or its owner. The command reads each destination Kitchen's fee.

```sh
sauce run cross-chain.sauce.ts --chain base --keystore <keystore> --args <address> <address>
```

**(c) An intent built elsewhere, from a Pot.** (a) and (b) fund by transfer and publish every intent
a file opens, so an intent you write with `<Chain>.hop({ … })` needs nothing more. This file
is only for an intent you did not write: a route and a reward another tool encoded, published from a
Pot. [examples/fund-by-transfer.sauce.ts](examples/fund-by-transfer.sauce.ts) takes them as
`publish`'s three arguments and does in one cook what (a) does: it reads the vault with
`EcoRoutes.Portal.intentVaultAddress(destination, route, reward)`, the registry's Portal on the
chain it runs on, transfers each reward token there, calls
`EcoRoutes.Portal.publish(destination, route, reward)` and returns `{ intentHash, vault }`. Its
arguments are an intent's `route` bytes and reward, as the record of an intent gives them; decode
the Portal's functions with their signatures (in [references/portal.md](references/portal.md)). An
intent from a solver's quote is funded with `publishAndFund` instead (below).

```sh
sauce run fund-by-transfer.sauce.ts --chain base \
  --keystore <keystore> --args <destination> <route> <reward>
```

- A native reward is an item of its own in `reward`, `{ native: amount }` in wei, beside the
  tokens (`reward: [{ token: USDC, amount }, { native: 1000000000000000 }]`): native coin the Pot sends
  to the vault the same way; `--fund ETH:<amount>` brings it in as the cook's value. The example
  funds tokens only and refuses a native reward.

**Quoted intents.** A solver that quoted an intent marks its quote funded when it sees
`IntentFunded`, which only `publishAndFund` and `fund` emit. For an intent built from a solver's
quote, fund it with `publishAndFund`: (a) or (b) with `--intent-fund-via publishAndFund`, not by
transfer. The Pot then approves each reward token to the **Portal** for exactly the reward (a
smaller allowance already standing is reset to zero first, as USDT requires), and
`publishAndFund(destination, route, reward, false)` pulls the reward into the same vault and marks
the intent Funded, inside the cook.

`sauce inspect <file> --chain <chain>` lists each intent the file opens, offline: its destination,
the body it cooks there and what the program gives the body as it runs. An intent's route and
reward exist once the program runs: `sauce intent publish --dry-run` prints them, read from the
Portal's log.

## The body

The body is a program for the destination, a single transfer included, compiled with the file and
cooked on the destination Portal Executor's **shared Pot**, which pays the destination Kitchen's
fee: the command reads the fee unless the hop's `fee` gives it, and it becomes the route's
`nativeAmount`, which the solver sends and the reward covers.
The delivered tokens arrive at the Executor and the route moves them into the Pot before the cook,
so the body spends what `receive` names and nothing else that intent owns. Its token writes
are SafeERC20's (`sauce-script`): a `false` return reverts the fulfilment, and USDT works. Here the
solver brings on Ethereum what the Pot holds on Base, less 0.1%:

```sauce chain=base
function main(beneficiary: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  const delivered = amount - (amount * 10) / 10000;
  await Ethereum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  });
  USDC.approve(AaveV3.Pool, delivered);
  AaveV3.Pool.supply(USDC, delivered, beneficiary, 0);
}
```

The gap between `delivered` (brought on Ethereum) and `amount` (paid on Base) is the solver's
margin. Make it worth filling.

## A whole program as the body

The body can be any program for the destination. It is written after the `await` (or inside
`.then`'s braces) and uses `main`'s parameters as values. It may also use what the file declares: its imports (an ABI, a library)
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
  await Base.hop({
    reward: { token: WETH, amount: reward }, // the source chain's WETH
    receive: { token: WETH, amount: amountIn }, // Base's WETH
    refundee: refundTo,
  });
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
escrowed until it is refunded. On an EVM destination, a `try` around the hop handles the body
instead. When the body reverts, everything it did is undone, the handler runs on the destination in
its place, and the fill succeeds. Here a supply that fails hands the delivered USDC to the
beneficiary:

```sauce chain=base
function main(beneficiary: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  try {
    await Ethereum.hop({
      reward: { token: USDC, amount },
      receive: { token: USDC, amount },
      refundee: refundTo,
    });
    USDC.approve(AaveV3.Pool, amount);
    AaveV3.Pool.supply(USDC, amount, beneficiary, 0);
  } catch (e) {
    USDC.transfer(beneficiary, amount);
  }
}
```

Without `await`, the handler is `.catch(...)` after `.then(...)`:

```sauce chain=base
function main(beneficiary: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  Ethereum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount },
    refundee: refundTo,
  })
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
first (`e.slice(0, 4)`). Write `.catch(() => { … })` when the handler does not read it. A handled body is always a program, so its cook pays the destination's Kitchen fee.

## Cascades

An intent's body can open the next one, so hops read top to bottom: each `await` is the next hop,
and the code after it runs on the chain it hopped to. Each level pays the next solver what it was
delivered, so every amount follows from the first, and each solver keeps its margin (0.1% here).

```sauce chain=base
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self()); // this Pot's own, on Base
  const onEthereum = amount - amount / 1000; // what the first solver delivers
  const onBase = onEthereum - onEthereum / 1000; // what the second delivers
  await Ethereum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount: onEthereum },
    refundee: refundTo,
  });
  await Base.hop({
    reward: { token: USDC, amount: onEthereum }, // Ethereum's: what this level received
    receive: { token: USDC, amount: onBase },
    refundee: refundTo, // every level names its own
  });
  USDC.transfer(recipient, onBase); // Base's USDC
}
```

Each level is a separate fulfilment by a solver, later, on its own chain: a failure on a later hop
does not undo an earlier one. The child is published and funded **by the parent's body**, as (b)
above: when the Ethereum level runs, the shared Pot there pays the next level's reward into its
vault on Ethereum's Portal from what that level was delivered, in Ethereum's USDC, and calls
`publish`, so the child is published like any other intent and any solver can discover it. Keep
every level on a supported chain, as here (Base, Ethereum, then Base again): the command checks the
first level's chains only.

The same cascade with each body written out with `.then(...)` compiles to the same program:

```sauce chain=base
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  const onEthereum = amount - amount / 1000;
  const onBase = onEthereum - onEthereum / 1000;
  Ethereum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount: onEthereum },
    refundee: refundTo,
  }).then(() => {
    Base.hop({
      reward: { token: USDC, amount: onEthereum },
      receive: { token: USDC, amount: onBase },
      refundee: refundTo,
    }).then(() => {
      USDC.transfer(recipient, onBase);
    });
  });
}
```

No `async` is needed. An `await` is a statement directly in `main`'s body, in the body of an
intent, or in a `try` block there. Everything after it, to the end of that body, runs on its
destination: names resolve there, values from before it are captured and cannot be assigned or
declared again, and a `return` is the body's. An `await` inside an `if`, a loop or another block, in
another function, or used as a value is a compile error, and so is `await` followed by `(`, `[` or a
line break in `main` or a body, where it reads as a name: start the hop on the `await`'s line.

A `try` around awaited hops handles each body, and what runs before them. The handler runs on
whichever chain failed and resolves its names there. It is compiled once per chain, and
`chainId == Ethereum` is decided as it is (a chain's name is its id), so each chain keeps only its
own branch, which moves only what that chain can account for:

```sauce chain=base
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  const delivered = amount - amount / 1000;
  try {
    await Ethereum.hop({
      reward: { token: USDC, amount },
      receive: { token: USDC, amount: delivered },
      refundee: refundTo,
    });
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

Each level's hop takes its own fields, and each it leaves out takes its default for that level:

- **Deadlines** count from when the level opens, which for a level below the first is when the
  body above it runs: its fill deadline is 5 minutes after that, and its reward's 7 days after the
  fill deadline. A deadline flag (`--intent-deadline`, `--intent-reward-deadline`) is the same
  second for every level that sets none, so a later level has whatever time the earlier ones leave.
- **The refundee** has no default at any level: each names its own, here the same `refundTo`, which
  reclaims each level's unearned reward on the chain that escrowed it, so it must be an address its
  owner controls on each of them.
- **The salt** is random for each level, picked when the file compiles; `salt` gives one.
- **The fee** is each destination Kitchen's own, read for every chain a level's program runs on.
- **The Portal and the prover** are looked up per level, for its own two chains.

The hash of a level below the first exists only once the level above has run: import it from that
fill's transaction (`sauce intent import <tx hash> --chain <chain>`), then fill, prove and claim it
like any other.

## What the compile supplies, and what you pass

The Portal, the prover, the destination Pot and the encoding are looked up from the eco-routes
registry, which records each chain's Portal and a prover deployed on both sides. Each chain's file in
`sauce-chains` says whether it takes intents and gives its Portal and Executor
([../sauce-chains/references/index.md](../sauce-chains/references/index.md)); the shared intent Pot,
the same on every chain, is `evm.intentPot` in
[../sauce-chains/references/deployments.json](../sauce-chains/references/deployments.json). Every
other value has a default ([references/defaults.md](references/defaults.md)); two deserve a thought:

- **The fill deadline**, 5 minutes after the intent opens unless the hop's `deadline` says
  otherwise: long enough for a solver that quoted it, short for one that must find and rehearse
  it first.
- **The fee** of a program body: the destination Kitchen's fee is mutable on chain and lives on the
  destination, so the command reads it there when it builds the intent (an `eth_call` of
  `executionFee()` on the destination's Kitchen, `evm.kitchen` in the deployments file above). An
  increase before the fill makes the cook, and the fulfilment, revert: build close to sending. With
  `--offline`, give it as the hop's `fee` or `--intent-execution-fee <wei>`.

**Units and arguments.** Amounts are base units (`1000000` is 1 USDC); only `--assume-balance`
and `--fund` take whole tokens. In `--args-json`, write an address or any value past 2^53 as a JSON
string (`"1000000000000000000"`): a JSON number loses precision.

Refused at compile time, never silently changed: a name the program does not declare, a hop with
no `refundee` or no `reward`, a program body's fee nothing supplies (offline with no fee), a hop
with no body (nothing after its `await`, no `.then(...)`), a step after the wrong one, a chain with
no eco-routes deployment, a pair with no prover deployed on both sides.

## The destination side

- **The shared Pot.** A program body cooks on the destination Portal Executor's **shared Pot** (its
  owner is the Executor, its salt zero); the destination's file in `sauce-chains` gives the
  Executor, and the deployments file above the Pot. **The Pot must exist before any fill**: until it
  does, every fulfilment of a program body reverts (`CallToEOA`). `sauce pot --chain <destination> --owner <Executor>` prints its
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

- **The source side**: `sauce intent publish --dry-run --assume-balance …` (above) rehearses the
  cook that pays the vault and publishes, and prints each intent; `sauce simulate` rehearses any
  file run from a Pot.
- **The fill, on the destination**: the body runs there, when a solver fills the intent, and that is
  where a swap misses its minimum or a refund fails. Rehearse it with `sauce intent fill`, the same file
  and flags, before publishing; it signs nothing and sends nothing:

```sh
sauce intent fill swap-on-base.sauce.ts --chain <chain> \
  --intent-deadline <unix seconds> --args-json <args.json>
```

It first reads the file's intents from a rehearsal of publishing them on the source chain: the
file cooked on `--owner`'s Pot (by default an account nobody holds the key of) with the rewards
left unpaid, each intent rebuilt from the Portal's log, a value the program measures measured on
that Pot as it stands. Then on each intent's destination it runs, in one simulated block, what a
solver sends: the shared
Pot's deployment when the body cooks on it and nobody has deployed it yet, the solver's approval
of the destination Portal for the delivered tokens, then `Portal.fulfillAndProve` with the
Kitchen's fee and the prover's fee as its value (or `Portal.fulfill` with the Kitchen's fee alone,
with `--no-prove` or a prover it does not drive). The solver is given the delivered tokens for the rehearsal only. It prints each
transfer, each address's net change (an address one of `main`'s arguments holds is named by it) and what
the shared Pot and the Executor were left holding, which must be nothing; or why the fill
reverts, down to the body's own `require` message. It warns when the shared Pot is not deployed,
and when the fee given (the hop's `fee` or `--intent-execution-fee`) is below the destination Kitchen's,
naming the fee to pass.
It reads the source and the destination chains (`--rpc-url`, for an endpoint of your own, is the
destination's and works when every intent goes to one chain; `--config` names the others). Fix
what it reports and rehearse again before `sauce intent publish` or `sauce run`. With `--send` and
a signer, `sauce intent fill` then fills it for real (above).

- **The body alone, as a program**: copy the body (what follows the `await`) into a file of its own,
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
  1. Get the intent: `sauce intent publish <file> --chain <source> --from <address> --dry-run
--json`, with the same intent flags and `--args`, prints each intent's record: its
     `intentHash`, `routeHash`, `rewardHash`, route and reward.
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
  Ethereum. It measures its amount on the Pot it runs on.
- [examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the distributed swap as the
  body of an intent to Base, opened from Ethereum. Its amounts are `main`'s arguments, and
  `sauce intent publish --fund` brings its reward into your Pot as it publishes.
- [examples/fund-by-transfer.sauce.ts](examples/fund-by-transfer.sauce.ts) publishes an intent
  built elsewhere from a Pot, funded by a transfer into its vault, in one cook.
- [examples/intents.mts](examples/intents.mts) compiles the intent files, with the refundee and
  Base's and Ethereum's fees as developer inputs, and pins the defaults (each the
  program its field writes), the fields example, on which chain each name resolves, the fee
  every body's cook pays, the pool ABI's selectors, and the shared Pot a fill needs.
