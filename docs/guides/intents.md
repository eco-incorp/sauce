# Create and fund an Eco intent

[Documentation](../README.md) · [Routes API](../api/routes.md) · [Nested intents](nested-intents.md)

An Eco intent is an offer: _run this program on that chain, and the reward escrowed on this one is
yours_. A program opens one by hopping to that chain:

```js
await Base.hop({
  reward: { token: USDC, amount: 1010000 },
  receive: { token: USDC, amount: 1000000 },
  refundee: refundTo,
});
USDC.transfer(recipient, 1000000); // runs on Base
```

The chain you hop to is the **destination**, where the body runs: the code after the `await`, and
therefore which compiler target, token addresses and protocol deployments apply. `reward` is
escrowed on the **source**, the chain the program runs on, until someone earns it; `receive` names
what a solver delivers on the destination for the body to use. As in JavaScript, `await x; rest` is
`x.then(() => { rest })`, so `Base.hop({ … }).then(() => { … })` is the same intent with its body
written out.

TypeScript builds one with the same object, naming the source as well. Every chain is a named
export; import the ones you use.

```ts
import { Base, Ethereum } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

export function buildApprovalIntent(
  reward: routes.HopReward,
  refundee: routes.HopAddress,
  executionFee: bigint,
) {
  return Base.hop({ source: Ethereum, reward, refundee, fee: executionFee }).then(() => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  });
}
```

In TypeScript, `.then(...)` writes the statement a program opens that intent with, compiles it for
the source chain, and returns the program and its cook (`routes.HostIntent`); it sends nothing. The
intent is the one the same statement opens in a file: an intent is always published by a program,
cooked on a Pot on its source chain, and its hash is the one the Portal announces, read from the
`IntentPublished` in the cook's logs (`built.intents(logs)`). The SDK looks up the Portals and the
prover, derives the destination Pot and engine, sets the native amount the solver sends to what the
route's calls spend, and resolves registered token and protocol addresses. You choose the refundee,
read the Kitchen fees, fund your Pot with the reward and send the cook; the deadlines, the prover
and the salt have defaults ([Intent defaults](../reference/intent-defaults.md)). A solver then
decides whether to fulfill it; the SDK does not price the reward or promise a fill.

The SDK builds an intent between any two registry chains. For the initial release, Sauce supports
transactions on Ethereum, Base and Solana, and the [`sauce` command](cli.md) and the
[MCP server](mcp.md) publish an intent only when its source and every destination it opens, nested
ones included, are among them; each step after publishing is refused on a preview chain by the
chain it is sent on ([Chains](../reference/chains.md)). Several examples below
name Arbitrum or Optimism, which are preview chains: the SDK builds them as shown, and submitting
one is at your own risk.

## Source, destination, and funding

A hop's one object sets both sides of the intent, each field at most once and in any order:

| Field or step    | Sets                                                                           | When you omit it                                           |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `Base.hop`       | Destination chain, where the body runs                                         | Required                                                   |
| `reward`         | The reward: `{ token, amount }` items, and native coin as `{ native: amount }` | Required; it must offer something                          |
| `source`         | Chain where the reward is escrowed and the intent published                    | Required in TypeScript; in a program, the chain it runs on |
| `refundee`       | The refund address: who may reclaim an unearned reward                         | Required; see [the refundee](#where-each-value-comes-from) |
| `rewardDeadline` | From when an unproven reward may be refunded                                   | The fill deadline plus seven days                          |
| `prover`         | The source chain's prover, which accepts the proof of the fill                 | The registry's prover for the pair                         |
| `receive`        | Destination tokens the solver delivers to the Portal's Executor                | Nothing delivered                                          |
| `fee`            | The destination Kitchen's fee the body's cook pays                             | See [the fee](#where-each-value-comes-from)                |
| `deadline`       | The last second the intent may be filled                                       | Five minutes after the intent opens                        |
| `salt`           | The route's salt                                                               | 32 random bytes, picked per compile                        |
| `.then(body)`    | The body: a closure, or the statements of one                                  | In a program, what follows `await`                         |

`reward` and `receive` each take one item or a list of them.

[Intent defaults](../reference/intent-defaults.md) gives each default and why it is Eco's.
TypeScript builds the intent where no chain is read, so the source has no default there; the
refundee has none anywhere. Overriding what the registry derives — the source and destination
Portals, the destination Pot and engine — is the compile's `intents` options (`sourcePortal`,
`destinationPortal`, `pot`, `engine`), which TypeScript passes in the hop's `compile`
([Routes API](../api/routes.md)).

The prover is the one `ecoRoutesProver(source, destination)` names: the first of eco-routes'
provers, the HyperProver first, that the registry records on both chains, in the deployment
`options.ecoRoutes` selects. An intent a program opens and `sauce intent publish` record the same
one. A pair the registry has no prover for is refused with the reason, until you pass one. Override
the Portals and the prover together, and only for a deployment the registry does not carry.

Destination route assets initially arrive in the **Executor**. The Sauce program executes in the **Pot**. A hop moves each token its `receive` names from the Executor into the Pot before the cook, so the body spends what was delivered.

Every EVM `cook` must receive the Kitchen's current `executionFee()` in native wei, including ERC-20-only programs: a hop's `fee` is that value. The Pot remits the fee before executing; its existing balance cannot replace this payment. Nested programs add another cook and fee. Read the fee before building; an increase before fulfillment can make the route revert.

The Portal hands the Executor the route's `nativeAmount`, and the Executor pays each call its `value` from it, so `nativeAmount` is the sum of the calls' values: the cook's fee, and each nested child's fee and forwarded native reward. For one cook that is the fee you read; the solver sends it with the fill.

On Arc the native coin is USDC, so every one of these native amounts is USDC at **18 decimals**,
while `tokens` amounts of Arc's `USDC` are 6 decimals — and both draw on one balance. See
[Arc: USDC is the native coin](../reference/chains/arc.md#notes).

Deadlines are absolute Unix timestamps in seconds. The route's deadline limits destination fulfillment. The reward's allows source refunds when no valid proof exists; leave time for fulfillment and proof delivery before it. Left out, each counts from when the intent opens: the fill deadline five minutes later, the reward's seven days after that, so each publication is a new intent.

## The destination Pot

A route call runs as the Executor of the Portal that fulfils it, and a Pot's `cook` accepts only
its owner. So the Pot's owner must be the **`executor()` of the Portal the route records** —
`intents.destinationPortal` when you set it, the registry's otherwise. A user-owned or solver-owned Pot rejects
the call with `NotOwner()`.

You do not supply one. The builder uses the Pot an intent opened in a program
[derives](#the-destination-pot-is-derived) — CREATE2 from the released Kitchen over that Executor
and salt zero (`SAUCE_INTENT_POT_SALT`) — and the released engine. That is the one Pot the solver
deploys per Portal and every intent through that Portal shares. The compile options
`intents.pot` and `intents.engine` override them. `destinationPot(Base.chain, { portal })`
returns that address.

The address also follows the pinned Kitchen release's Pot bytecode, whose hash is part of every Pot
address. A Kitchen release that changes that bytecode starts a new family: the shared Pot for the
same Executor moves to a new address, and a Pot of the earlier family keeps running on the engine
built for it. `destinationPot` always answers for the family this SDK pins.

**The destination Pot must exist before the intent is fulfilled.** The SDK derives its address and
deploys nothing: the route contains no deployment call. The solver deploys the shared Pot for each
Portal. A fulfilment that cooks on a Pot that is not there reverts entirely, because the Executor
refuses a call with calldata to an address without code (`CallToEOA`).

To deploy it yourself first, send this on the destination chain:
`routes.sauceEvmDeployPotCall({ owner: executor, salt: SAUCE_INTENT_POT_SALT })`.
The call is permissionless, and it returns the existing Pot when one is already there. A **Pot you
name** instead must also exist, and be owned by that Executor, or the cook reverts with `NotOwner()`.
Use
[evm-execution.ts](../examples/evm-execution.ts) with the destination Portal and a salt — zero for
the shared Pot — to predict the Pot and check that it is deployed, with the right `owner()` and
`kitchen()`. Only use a result with `ready: true`.

### One Portal, one Pot

The registry records one eco-routes Portal, `0xEC000769A73b70e16f361a442292500b3BCf4A85`, on every
EVM chain it has eco-routes on, Arc included. So one Executor
(`0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082`) and one derived Pot (`destinationPot(chain)`, on
[Deployments](../reference/deployments.md#the-shared-intent-pot)) serve every destination.
This prediction uses the pinned Kitchen release's Pot bytecode. The Kitchen, the matching engine and
that Pot must be deployed on the destination before an intent to it can run; the release address
alone does not confirm readiness.

A solver fills an intent only on the Portal it serves: an intent published on a different Portal
deployment is not one it can fill. Set `intents.destinationPortal` or `intents.sourcePortal` only to
a Portal you have confirmed a solver serves.

The deployment helpers return the released addresses. They do not check that code is live at those
addresses on your chain. The same helper confirms the Kitchen and engine have code, and reads the
execution fee you need either way.

An Executor-owned Pot can be invoked by other valid Portal routes, and the derived one is shared by
every intent through its Portal. Deliver assets, use them, and return leftovers **within the same
fulfillment**; leave nothing in it — no user funds, no standing allowances. Source reward escrow
belongs in the intent vault. These caller and custody rules follow [Eco Routes' Executor calls](https://github.com/eco/eco-routes/blob/49de5bb10a5eb00509b21702df6cf54de448ee11/contracts/Executor.sol#L50-L74) and [destination fulfillment](https://github.com/eco/eco-routes/blob/49de5bb10a5eb00509b21702df6cf54de448ee11/contracts/Inbox.sol#L225-L271).

## Build a Base USDC transfer intent

This function takes deployment and reward configuration as inputs. It delivers one USDC on Base to `recipient` and offers the configured source-token reward. It only constructs data.

```ts
import { Base, type routes } from "@eco-incorp/sauce";

interface TransferIntentConfig {
  executionFee: bigint;
  baseUsdc: routes.Hex;
  recipient: routes.Hex;
  source: routes.ChainRef;
  rewardToken: routes.AddressInput;
  rewardAmount: bigint;
  refundee: routes.AddressInput;
  routeDeadline: bigint;
  rewardDeadline: bigint;
}

export function buildBaseTransfer(config: TransferIntentConfig) {
  const amount = 1_000_000n;
  // The body is SauceScript, the statements of the body it runs: the values it needs are written
  // into its text.
  const body = `Token(${config.baseUsdc}).transfer(${config.recipient}, ${amount});`;

  return Base.hop({
    source: config.source,
    reward: { token: config.rewardToken, amount: config.rewardAmount },
    receive: { token: config.baseUsdc, amount },
    refundee: config.refundee,
    deadline: config.routeDeadline,
    rewardDeadline: config.rewardDeadline,
    fee: config.executionFee,
  }).then(body);
}
```

An intent is published from an EVM chain, by a cook on a Pot there. Its **destination** may be Solana — the encoding supports it — but see the [Solana guide](solana.md) for how that execution is actually built.

The route has two calls: the delivery into the Pot, and the cook.
`executionFee` is the destination Kitchen quote obtained above, and the route's `nativeAmount`, which the solver sends, is that fee. The source reward must separately compensate the solver for delivery, fees, and gas; the SDK does not price it.

The body names the delivered token by its address, `Token(address)`, so the token transferred into the Pot is the token the program spends. To use the SDK's Base USDC, resolve it with `routes.registryTokenAddress(Base.chain, "USDC")` and check the result before building. That lookup returns a `bigint`; convert it to a 20-byte hex address with Viem's `toHex(value, { size: 20 })` for intent token fields, as in the [complete example](../examples/first-intent.ts), where the body names Base's `USDC` by its symbol.

## Create an intent from inside a program

Everything above builds an intent in TypeScript, before anything runs. A program can also create one
_while_ it is running, which is what you want when the amount is the output of the step before it:

```js
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  await Arbitrum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount },
    refundee: refundTo,
  });
  USDC.transfer(recipient, amount);
}
```

The same object as the TypeScript builder, written in the program, where the chain it runs on is
the source. No Portal, prover, selector, encoding or approval appears, because none of them is a
decision you are making. The fields are the same, and so are their
[defaults](../reference/intent-defaults.md); a field's value may be one the program computes, such
as `deadline: ctx.timestamp() + 3600`.

Everything after the `await` is the body, compiled for Arbitrum. Written without `await`, the body
is the argument of `.then(...)`, and this is the same program:

```js
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount },
    refundee: refundTo,
  }).then(() => {
    USDC.transfer(recipient, amount);
  });
}
```

A hop in a body is the next hop, from that body's chain: that is how intents are nested, and a
cascade reads as one `await` after another ([nested intents](nested-intents.md)).

### The body is a Sauce program

Anything a route body can do belongs in there: protocol calls, control flow, locals, and an intent
of its own. Whatever it holds, the body is a program compiled for the destination and cooked on the
destination's shared Pot, a token transfer alone included:

| The body is…  | Becomes…                                               | Needs                   |
| ------------- | ------------------------------------------------------ | ----------------------- |
| any statement | a program compiled for the destination, run on its Pot | a Pot and a Kitchen fee |

The route the Portal's Executor runs is two kinds of call: a transfer of each token `receive` names
from the Executor into the Pot, then the cook. The cook pays the destination Kitchen's fee,
which becomes the route's native amount the solver sends, and which the reward covers. The program's token writes are
[`SafeERC20`](protocols-and-tokens.md#writes-follow-safeerc20): USDT works, and a token that
returns `false` reverts the fulfilment.

**`receive` names what the solver delivers** so the body has something to work with, and the
route moves it from the Executor into the Pot. It is never inferred from the body, and that is a
judgement rather than an omission: a program's `balanceOf` reads what is _there_, which may be
what an earlier call in the same route produced rather than what a solver must bring. Inferring an
obligation from it would silently under- or over-state what the intent asks for, and an intent that
asks for the wrong delivery is unfulfillable or overfunded. A hop with no `receive` delivers
nothing.

### Captured variables

`amount` is a local of the enclosing program, so its value does not exist until the program runs.
The intent is built while the file compiles, as one value with a place for each such variable, and
the program encodes it as it runs, with the variable's value written in. Any scalar works — an
amount, an address, a deadline, anything one 256-bit word wide. A computed amount or field,
`amount * 99 / 100`, is folded when every operand is known and otherwise computed where the intent
opens.

A variable can arrive two ways, and the same variable can do both:

- **Into the encoded intent** — a reward amount, a delivery amount, a field: written where the
  intent puts it.
- **Into the body's program** — it becomes one of that program's arguments, appended to the
  program in the cook's calldata, which the route records.

So an intent that uses one is known once the program has run: its hash and record are read from
the Portal's `IntentPublished` log.

### The file's functions, imports and constants

A program body was written in the file, so it can use what the file declares: its functions, its
imports, its interfaces and its module-level constants. Its program carries the ones the body
reaches, and the ones those reach, as written, and nothing else:

```ts
import { transfer } from "@sauce/token";

function fee(amount: Uint256): Uint256 {
  return amount / 100;
}

function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  await Arbitrum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount },
    refundee: refundTo,
  });
  USDC.transfer(recipient, amount - fee(amount));
  transfer(USDC, refundTo, fee(amount));
}
```

A carried declaration is compiled for the chain its program runs on, so `USDC` in `fee` would mean
Arbitrum's USDC there. A function only intent bodies call moves out of the enclosing program, which
never runs it; one that another remaining function calls stays. A local of the enclosing function
shadows a file declaration of the same name, as it does in the compiler: the body captures the
local. A module-level `let` the body's program uses starts with the value it has where the intent
opens — the program carries the declaration and is handed its value, the same value a reward naming
it escrows — so the body and every function it calls see one number. A body cannot call the
function that opens it, since that function's program would contain the intent it is the body of.

### Nesting

A hop inside a body is lowered recursively — the child is compiled by re-entering the same
pipeline, so it gets its own chain's names and this same lowering, at any depth. That is how a chain
of hops, each paying the next what it was delivered, is written; see
[nested intents](nested-intents.md#three-levels).

### Names resolve per chain

Two chains meet in `await Arbitrum.hop({ reward, receive, refundee })`, and each part belongs to
one of them. A token symbol resolves on the chain where its part runs:

| Part                                                     | Computed on                   | `USDC` is                              |
| -------------------------------------------------------- | ----------------------------- | -------------------------------------- |
| The body, what follows `await` or `.then(() => { ... })` | Arbitrum, the destination     | Arbitrum's                             |
| `receive`, what is delivered                             | The chain the program runs on | Arbitrum's: a token is looked up again |
| `reward` and every other field                           | The chain the program runs on | That chain's                           |

The reward belongs to the enclosing chain because the program escrows it there: it pays the reward
token into the intent's vault on that chain's Portal and publishes the intent in the same
fulfillment. Resolving a name on the other chain names an address that is not that token where it
is used. A reward token taken from the destination fails the transfer's code check and reverts the
fulfillment. A body token taken from the enclosing chain makes the intent unfulfillable.

The rule repeats at every depth. An intent opened inside a body is funded on that body's chain, so
its reward resolves there and its own body on its own destination. The same holds for the other
values that belong to a chain, `chainId` and protocol addresses such as `UniswapV4_UniversalRouter`:
a body on another chain sees that chain's own.

In `receive` only the tokens are the destination's, each symbol looked up again there by its
name; every other value in it, an amount included, is computed on the chain the program runs on,
where the intent opens. So `USDC` delivers Arbitrum's USDC, and `chainId` in an amount is the
enclosing chain's. A token only the destination has is named by its symbol all the same: from
Base, which has no USDT0, `receive: { token: USDT0, amount }` delivers Arbitrum's USDT0, and a
symbol neither chain has is refused, naming the destination. An address is used as written:
`Token(<address on the destination>)`.

A literal address means that address wherever it appears, and so does a compile-time define whose
name no chain uses, such as `RECIPIENT`. A define or a `tokens` override under a chain-scoped name —
a token symbol, `chainId`, a protocol address — is a name on the chain the program is compiled for.
It applies to that program and to the reward it funds. A body on another chain keeps that chain's
value, whether the define came from `chainDefines(base)` or was chosen by hand.

### A throw reverts everything

A `throw` or a failed `require` in a program, and every guard the SDK emits, reverts the whole
fulfillment — no earlier route call survives it. A program that refuses to create an intent
therefore leaves nothing behind, and a measurement below its floor cannot strand funds in the Pot.

### A handler for the body

On an EVM destination, a `try` around the hop handles its body. When the body reverts, everything
it did is undone, the handler runs in its place, and the fill still succeeds. Here a supply that
fails hands the delivered USDC to the beneficiary instead:

```js
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
`Ethereum.hop({ … }).then(() => { … }).catch((e) => { … })`. `e` is what the body reverted with, as
`bytes`: at most its first 256 bytes, the error's selector first. Write `.catch(() => { ... })` when
the handler does not read it. A handled body is always a program, so its cook pays the
destination's Kitchen fee.

### Where an `await` stands

No `async` is needed: the `await` is a statement of `main`'s body, and everything after it is the
body of the intent, compiled for the destination. Names after it resolve on the destination. Values
from before it are captured, and the body cannot assign them, nor declare a name again: `main` is
still one scope. A `return` after it is the body's. An `await` in the body opens the next hop from
the destination, so a cascade reads top to bottom.

An `await` stands directly in `main`'s body, a script's top level, a body, or a `try` block there.
It cannot be inside an `if`, a loop or another block, in another function, or used as a value; each
of these is a compile error that names it. Start the hop on the `await`'s line: in `main` or a body,
as in JavaScript outside an `async` function, `await` followed by `(`, `[` or a line break reads as
a name, and is refused.

A `try` around awaited hops handles each of their bodies, and what runs before them:

```js
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
      USDC.transfer(refundTo, delivered);
    } else {
      USDC.transfer(refundTo, amount);
    }
  }
}
```

`try { S1; await a; S2 } catch (e) { H }` is
`try { S1; a.then(() => { S2 }).catch((e) => { H }); } catch (e) { H }`, at every `await` in it:
the handler runs on whichever chain failed, and resolves its names there. It is compiled once per
chain, and `chainId == Ethereum` is decided as it is, so each chain keeps only its own branch: a
supply that fails on Ethereum returns what this intent delivered there, from the Pot every intent to
Ethereum shares; a failure on Base, where the intent opens, returns `amount` from the program's own
Pot. `chainId` tells chains apart, not hops: a cascade that visits a chain twice runs that chain's
branch on both visits, so the branch must be right for each of them, such as the smaller amount.
Nothing may follow such a `try`, and its handler cannot `await`.

In an editor, an `await` at a script's top level is plain TypeScript. One in `main` needs the
SauceScript plugin that `sauce init` configures, which accepts it where the compiler does.

### Where each value comes from

| Value              | Comes from                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Portal, both sides | The eco-routes deployment tables, by chain                                                             |
| Prover             | The tables, by source/destination pair                                                                 |
| Destination Pot    | Derived — see below                                                                                    |
| Engine             | The released engine address                                                                            |
| Destination        | The chain you named                                                                                    |
| Source             | The chain the program runs on                                                                          |
| Deadlines          | `deadline`, `rewardDeadline`, else the [defaults](../reference/intent-defaults.md), from when it opens |
| Salt               | `salt`, else 32 random bytes                                                                           |
| Refundee           | `refundee`, required. See below                                                                        |
| Execution fee      | `fee`, else the compile's, for a program body. See below                                               |

An intent **opens** when the program opening it runs, so a default deadline is `ctx.timestamp()`
plus its window, computed there. A compile given `compile.intents.openedAt` (Unix seconds) counts
the first level's from then instead, which makes the intent fixed when it is built; the `sauce`
command sets it to the moment it builds the intents. An intent a body opens, one level down, opens
when that body runs.

The **refundee** is the refund address: who may reclaim the reward if nobody earns it. The
executing Pot is the obvious default and the wrong one: it is owned by the Portal's Executor, which
every solver can drive, so a refund landing there is a refund anyone can take, and a Pot an owner
runs may be shared too. So every hop, at any depth, gives its `refundee`, usually one of `main`'s
parameters (`refundee: refundTo`), and nothing is taken from the level above, the Pot or the wallet
that sends the cook.

`refundee: a` sets the reward's `creator`: after the deadline a refund goes to `a`, and only `a`
may send the Portal's `refundTo` to redirect it.

The **salt** makes two otherwise identical intents two hashes. Left out, it is 32 random bytes picked
when the program compiles (`compile.intents.salt` fixes them, and the `sauce` command picks them
once per run, `--intent-salt` to choose), mixed as the intent opens with how many intents the
transaction has opened, kept in transient storage: two intents built alike in one program, or in a
loop, are two intents. A salt a hop gives, `salt: s`, is used as written.

The **execution fee** is the one value that cannot be derived. It is mutable on-chain, and it lives
on the destination, which the source chain cannot read while it executes. Read it at build time and
give it as the hop's `fee`, or as `compile.intents.executionFee`: one fee, or a function from the
destination chain to its fee, for a program whose intents reach several chains. The `sauce` command
reads each destination's Kitchen when given neither:

```ts
import { destinationExecutionFee } from "@eco-incorp/sauce";

const request = destinationExecutionFee();
// const { data } = await client.call(request);
// const executionFee = request.decode(data!);
```

Read it shortly before building: an increase before fulfillment makes the cook revert, which reverts
the fulfillment.

### The destination Pot is derived

A Pot is CREATE2 from the Kitchen over its owner and a salt, and the owner a route call must cook as
is the `executor()` of the Portal the child's route records — itself that Portal's second `CREATE`,
so it follows from the Portal address. That is the registry's Portal, or `destinationPortal` when you
override it: a route recording one Portal is run by that Portal's Executor, and a Pot owned by any
other Executor would refuse the cook with `NotOwner()`. Nothing is read from a chain and nothing is
asked of you. The salt is zero (`SAUCE_INTENT_POT_SALT`), so there is **one shared Pot per Executor**
rather than one per intent: the Pot the solver deploys for that Portal. A Pot is fixed by its owner
and salt, so whoever calls `deployPot(executor, 0)` creates that same Pot, owned by the Executor.

Deriving an address is not deploying a contract, and the lowering deploys nothing. **The Pot must
exist before the child intent is fulfilled** — the solver deploys it — or the fulfilment reverts
when the Executor calls an address without code.

A Pot you name with `pot` must equally exist already and be owned by that Executor.

Because it is shared, **leave nothing in it**. Deliver assets, use them, and move the remainder out
within the same fulfillment. Anything resting there, or any allowance left standing, belongs to
whoever drives the Executor next. On a destination the Pot is shared by every intent, so a body
moves only amounts it can account for — what its intent delivered, what a `@sauce/router` function
returns, or a balance's change across one step — never the Pot's whole balance.

### Overrides

Everything derived can be overridden through `compile.intents`, for every intent the program opens
whose hop does not give it:

| Field                        | Overrides                                                            |
| ---------------------------- | -------------------------------------------------------------------- |
| `deadline`, `rewardDeadline` | The route and reward deadlines                                       |
| `openedAt`                   | When the first level opens, which its default deadlines count from   |
| `prover`                     | The reward's prover                                                  |
| `sourcePortal`               | Where the intent is published                                        |
| `destinationPortal`          | The Portal recorded in the child's route                             |
| `pot`, `engine`              | Where a program body cooks, and on what; a named Pot is not deployed |
| `executionFee`               | The cook's value: one fee, or a function of the destination          |
| `fundVia`                    | How the reward is funded — see below                                 |
| `salt`, `allowPartial`       | The route salt, and partial funding (`publishAndFund` only)          |
| `fund`                       | `false` publishes each top-level intent without paying its reward    |
| `generation`, `environment`  | Which eco-routes deployment to address                               |

### How the reward is funded

By default the program pays the reward into the intent's vault itself, then publishes the intent.
In the same transaction it asks the source Portal for `intentVaultAddress` over the bytes it is
about to publish, transfers each reward token there with
[`SafeERC20`](protocols-and-tokens.md#writes-follow-safeerc20) semantics, sends the native amount
from the Pot's balance, and calls `Portal.publish`. The Portal counts an intent funded when its
vault holds the reward (`isIntentFunded`), which is what a solver checks once it has seen
`IntentPublished`. Nothing is approved, so no allowance is left on the shared Pot and a USDT-style
token needs no reset; a token whose transfer returns `false` reverts the fulfillment.

`fundVia: "publishAndFund"` — in `compile.intents`, or
`--intent-fund-via publishAndFund` on the command line — approves the Portal for each reward token
instead (resetting a standing allowance first) and calls `publishAndFund`, forwarding the native
amount as the call's value. The Portal pulls the reward into the same vault, records the intent
`Funded` and emits `IntentFunded`. Choose it when something you rely on reads that event or status
rather than the vault's balance. `allowPartial` applies only here.

### What is refused

Each of these is a compile error naming the construct, never a silently different intent:

- An identifier that is neither a compile-time value nor a variable of the enclosing program.
- A hop with no body (no `.then(() => { ... })` and nothing after an `await`), or a step after the
  wrong one, such as `.catch(...)` before `.then(...)`.
- A hop with no `reward`, an empty `reward: []`, an item missing `token` or `amount`, or a
  `{ native }` item in `receive`.
- A missing refundee: every intent names its own. A missing fee for a program body that nothing
  supplies.
- A chain with no eco-routes deployment, or a pair with no prover deployed on both sides.
- A program body that calls the function opening it.

A field a hop does not take is not refused by the compile: it is ignored, as TypeScript's editor
declarations flag it, and the TypeScript builder refuses it.

Inside a program body an unknown name is the _compiler's_ error rather than this lowering's, and
reads the same way: it names the variable that is not declared.

## Callbacks are compiled source

A callback is read with `Function.prototype.toString()`, parsed, and compiled as SauceScript. It is never invoked as a JavaScript callback and captures no outer variables. An `amount` in surrounding JavaScript does not become a value inside the program.

Use literals in a callback. A value of your application goes into the program's text: write the body as a source string with the value in it, as [above](#build-a-base-usdc-transfer-intent), pass it as a define (`compile: { defines: { AMOUNT: amount } }`, read as `AMOUNT` in the body), or write the intent as a file whose `main` takes the value as an argument. Local declarations in the program take precedence over ambient names.

A chain the callback hops to, `Ethereum.hop({ … }).then(() => { … })`, is the imported chain export, whose `hop` takes SauceScript values as well as the host's; import it as you import `Base` ([nested intents](nested-intents.md)). The package declares SauceScript's builtins for TypeScript — `ctx`, `crypto.keccak256`, `hex`, `Math.mulDiv`, `require(condition, message)`, `abi`, `evm`, `svm`, `.toBytesBe(...)` and the rest of the [reference](../reference/saucescript.md) — as it declares token symbols and protocols, so a typed callback that uses them typechecks. The declarations install nothing at run time, and a builtin's comment says which targets have it: TypeScript does not know which chain the callback compiles for.

Callbacks must be synchronous and take no parameters. Bound/native functions, generators, and async functions are rejected. If a bundler transforms function source, ship an explicit SauceScript string or source asset. A TypeScript type declaration does not create a captured value.

A function the callback declares in its own body is a helper of the program: SauceScript has no nested functions, so it is declared beside `main`, and an intent opened inside the callback can call it like any other function of the file. Its annotations are whatever the host's TypeScript compilation left in the callback's text, which is usually none, so a helper that takes or returns an array or a record belongs in a source string.

A program compile (`compileSauceProgram`, and so every hop and every body) adds the SDK's default ambient token module, enabling function forms such as `approve(tokenAddress, spender, amount)`. Direct `compileSauceRoute(...)` does not automatically add that ambient module. The token and protocol member syntax described in [protocols and tokens](protocols-and-tokens.md) works on both paths; its writes are the same module's functions, so they have the same `SafeERC20` semantics either way.

## Publish it: the cook

An intent is published by its cook. `built.cook(target, value)` is `Pot.cook(engine, program)` on
`target` — your Pot's address, or `{ owner, salt? }` — with `value` the source Kitchen's fee: send
it from the Pot's owner. The program it runs pays each reward into its intent's vault, then calls
`Portal.publish`, in one transaction: by default an ERC-20 `transfer` per reward token (for the
largest amount listed for it) and a plain send of the native amount. The Portal counts an intent
funded when its vault holds the reward (`isIntentFunded`), and that is what a solver checks after
it sees `IntentPublished`. No approval is asked for, so none is left standing and a USDT-style token
needs no reset. With `intents.fundVia: "publishAndFund"` the program approves the source Portal
instead (reset to zero first where an allowance stands) and calls `publishAndFund`, which pulls the
reward, records the intent `Funded` and emits `IntentFunded`: choose it when something you rely on
reads that event or status rather than the vault's balance.

**The Pot holds the reward when the cook runs.** Send it there first, or have
[`sauce run --fund`](cli.md#intents-sauce-run-or-sauce-intent) pull it from your wallet in the same
cook, as [`sauce intent publish`](cli.md#intents-sauce-run-or-sauce-intent) does for a file. The Pot
must be deployed (`routes.sauceEvmDeployPotCall({ owner, salt })`).

**Read the intent from the cook's logs.** `built.intents(receipt.logs)` returns each intent the
source chain's Portal published, rebuilt from its `IntentPublished` and held to the hash it
announces, with its destination and the Portal that published it, where it is claimed and
refunded; a rehearsal's logs (`eth_simulateV1`) give the same before anything is sent. That is the
intent every later step takes.

For an intent built some other way, `routes.intentSourceTxs(intent, { portal }, options)` builds
the wallet's own funding and `publish` requests, the same two modes; `predictIntentVault` and
`intentVaultAddressCall` give its vault, and a `vault` you read is checked against the prediction
(`IntentVaultMismatchError`).

## Rehearse the fill on the destination

Publishing proves the reward is escrowed, not that the intent works. Its body runs on the
destination, inside the solver's fill, so a swap that falls short of its minimum or a refund that
fails shows up only there. A solver sends two things on the destination chain:

- an approval of the destination Portal for each token the route delivers, which the Portal pulls
  from the solver into its Executor;
- `Portal.fulfill(intentHash, route, rewardHash, claimant)`, with `route.nativeAmount` as its value
  — the Kitchen's fee for each cook in the route, plus any native the calls spend.

`routes.fulfillApprovalTxs(intent)` and `routes.fulfillTx(intent, { claimant })` build them, for an
EVM destination, from the intent as published:

```ts
import { routes } from "@eco-incorp/sauce";

export function solverTransactions(published: routes.LoggedIntent, claimant: routes.Hex) {
  const { intent } = published;
  return [...routes.fulfillApprovalTxs(intent), routes.fulfillTx(intent, { claimant })];
}
```

Rehearse them before publishing. A route that cooks needs the shared Pot deployed first, so a
rehearsal on a chain where nobody has deployed it yet puts `Kitchen.deployPot(executor, 0)` ahead
of the fill, in the same simulated block. From the command line,
[`sauce intent fill`](cli.md#rehearsing-the-fill-sauce-intent-fill) does all of it with no key: it
takes a published intent by its hash, or previews a file's, read from a rehearsal of publishing
them on the source chain (so their hashes are the rehearsal's), gives a solver
the route's tokens by state override, runs the deployment, the approvals and the fill in one `eth_simulateV1` block on
the destination, and prints what moved, what the shared Pot and the Executor were left holding, and
the decoded reason when it reverts. With `--send` and a signer it then sends them, the signer being
the solver ([`fill --send`](cli.md#filling-it-for-real-sauce-intent-fill---send)), on a supported
destination only.

## After the fill: prove, claim, refund, cancel

The fill is recorded on the destination; the reward is on the source. What carries one to the other,
and what happens when nobody fills, is the Portal's, on eco-routes' own terms:

1. **Prove.** The destination Portal's `prove(prover, sourceDomain, intentHashes, data)` hands what
   it recorded for each intent (the claimant, or a cancellation) to the destination's prover, which
   sends it to the reward's prover on the source for a fee it quotes. `fulfillAndProve` is the fill
   and the proof in one transaction, its value the route's native amount plus that fee. Through
   Hyperlane, `data` is `abi.encode((bytes32 sourceChainProver, bytes metadata, address hook))` — the
   source prover, empty metadata and no hook take the Mailbox's defaults — and the source domain
   is an EVM source's chain id. The Portal forwards its whole balance to the prover, which keeps its
   fee and refunds the rest to the sender, so overpaying is safe.
2. **Claim.** Once the bridge delivers it, the source prover's `provenIntents(intentHash)` returns
   the claimant, and the source Portal's `withdraw(destination, routeHash, reward)`, sent by anyone,
   pays that claimant the reward from the vault (`batchWithdraw` for several).
3. **Refund.** `refund(destination, routeHash, reward)`, sent by anyone, returns everything the
   vault holds of the reward to its creator: from the reward's deadline when no fill is proven,
   only the leftovers once the claimant has withdrawn, and never while a proven claimant has not.
4. **Cancel.** A destination Portal with `cancel` lets anyone cancel an unfilled intent strictly
   after the route's deadline; no fill can land after it, and proving the cancellation lets the
   creator refund at once. The cancellation travels as a claimant nobody controls, so the source
   Portal must refuse to pay it (its `withdraw` reverting `CancelledIntent`): prove one only to a
   source whose Portal does, and only once the cancel is final on the destination.

`routes` builds each as calldata, and the reads that decide them:

```ts
import { routes } from "@eco-incorp/sauce";
import { ecoRoutesPortal, ecoRoutesProver } from "@eco-incorp/sauce/protocols/eco-routes";

export function afterTheFill(intent: routes.Intent, fee: bigint) {
  const source = Number(intent.sourceChainId);
  const destination = Number(intent.destination);
  // The registry's, as the builder chose them: the source Portal, and the destination's prover of
  // the pair the reward's prover belongs to. Name your own for a deployment it does not carry.
  const sourcePortal = ecoRoutesPortal(source);
  const prover = ecoRoutesProver(destination, source);
  const data = routes.hyperlaneProverData({ sourceProver: intent.reward.prover });
  const proof = { prover, sourceDomain: intent.sourceChainId, data, fee };

  return {
    prove: routes.proveTx([intent], proof), // on the destination; value: the fee
    claim: routes.withdrawTx(intent, { portal: sourcePortal }), // on the source
    refund: routes.refundTx(intent, { portal: sourcePortal }), // on the source
    cancel: routes.cancelTx(intent), // on the destination, after the route's deadline
    proven: routes.provenIntentCall(intent), // the source prover's record: claimant, destination
    recorded: routes.fulfillmentCall(intent), // the destination's claimants[intentHash]
    status: routes.rewardStatusCall(intent, { portal: sourcePortal }), // Initial … Refunded
    fee: routes.proverFeeCall({
      prover,
      sourceDomain: intent.sourceChainId,
      destinationChainId: intent.destination,
      pairs: [
        { intentHash: routes.hashIntent(intent).intentHash, claimant: intent.reward.creator },
      ],
      data,
    }),
  };
}
```

`routes.fulfillAndProveTx(intent, { claimant, ...proof })` is the fill and its proof in one, and
`routes.cancelAndProveTx(intent, proof)` the cancellation and its. From the command line,
[`sauce intent prove, claim, refund and cancel`](cli.md#after-the-fill-prove-claim-refund-cancel)
send them on a supported chain, reading the state first and saying why not, and
[`sauce intent status`](cli.md#after-the-fill-prove-claim-refund-cancel) reads where an intent
stands on both chains. `routes.intentFromPublished(log, sourceChainId)` rebuilds an intent from its
`IntentPublished` log, which `sauce intent import` stores.

## Inspect hashes, vaults, and status

A published intent's hash is the one its log announced: `routes.hashIntent(intent)` returns its
`intentHash`, `routeHash` and `rewardHash`, the same values, and `routes.predictIntentVault(intent)`
its vault, an offline CREATE2 prediction with nothing read from a chain: an eco-routes Portal's
vaults are clones, salted with the intent hash, of a Proxy over the Portal's first `CREATE`, so the
address follows from the Portal's own. `routes.intentVaultAddressCall`, `intentHashCall` and
`isIntentFundedCall` build the matching reads of the source Portal, each a request plus its
decoder, to run on the source chain.

For a Solana destination, build the execution with the Kitchen client rather than the SVM route helpers: the instruction those helpers emit is not one the Solana engine accepts, and staging the code does not change that. The [Solana guide](solana.md) has the supported path.
