# Create and fund an Eco intent

[Documentation](../README.md) · [Routes API](../api/routes.md) · [Nested intents](nested-intents.md)

An Eco intent is an offer: _run this program on that chain, and the reward escrowed on this one is
yours_. `Base(body, options).reward(reward)` builds one. The chain you call names the **destination**
— where the program runs, and therefore which compiler target, token addresses and protocol
deployments apply. `.reward(...)` names the **source**, where the reward sits until someone earns it.

`Base.route(...)` is the same function. Every chain is a named export; import the ones you use.

```ts
import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

export function buildApprovalIntent(routeOptions: routes.IntentOptions, reward: routes.RewardArg) {
  return Base(() => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  }, routeOptions).reward(reward);
}
```

The SDK builds the intent and the transaction requests, and sends nothing. It looks up the Portals,
derives the destination Pot and engine, and resolves registered token and protocol addresses. You
choose the deadlines, creator and prover, read the Kitchen fee, fund the reward and submit. A solver
then decides whether to fulfill it; the SDK does not price the reward or promise a fill.

## Source, destination, and funding

An intent has two sides:

| Field                                    | Meaning                                                           |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `Base(...)`                              | Destination chain where the Sauce program executes                |
| `options.portal`                         | Destination Portal recorded in the route                          |
| `options.pot`, `options.engine`          | Overrides for the derived destination Pot and released engine     |
| `options.tokens`, `options.nativeAmount` | Destination assets delivered by the solver to the Portal Executor |
| `reward.source`                          | Chain where the reward is funded                                  |
| `options.sourcePortal`                   | Source Portal used by submission and read helpers                 |
| `reward.tokens`, `reward.nativeAmount`   | Source assets offered as the reward                               |
| `reward.creator`, `reward.prover`        | Creator and prover recorded in the reward                         |

Destination route assets initially arrive in the **Executor**. The Sauce program executes in the **Pot**. For an ERC-20 program that spends solver-delivered assets, prepend a token transfer from the Executor to the Pot. Native value reaches the Pot through `execution.value`; declaring `nativeAmount` alone does not forward it into `cook`.

Every EVM `cook` must receive the Kitchen's current `executionFee()` in native wei, including ERC-20-only programs. Set `execution.value` to **fee + native assets the program needs**, and budget `nativeAmount` for the route's calls. The Pot remits the fee before executing; its existing balance cannot replace this payment. Nested transfer programs add another cook and fee. Read the fee before building; an increase before fulfillment can make the route revert.

On Arc the native coin is USDC, so every one of these native amounts is USDC at **18 decimals**,
while `tokens` amounts of Arc's `USDC` are 6 decimals — and both draw on one balance. See
[Arc: USDC is the native coin](../api/coverage.md#arc-usdc-is-the-native-coin).

Deadlines are absolute Unix timestamps in seconds. `route.deadline` limits destination fulfillment. `reward.deadline` allows source refunds when no valid proof exists; leave time for fulfillment and proof delivery before it.

## The destination Pot

A route call runs as the Executor of the Portal that fulfils it, and a Pot's `cook` accepts only
its owner. So the Pot's owner must be the **`executor()` of the Portal the route records** —
`options.portal` when you set it, the registry's otherwise. A user-owned or solver-owned Pot rejects
the call with `NotOwner()`.

You do not have to supply one. With no `execution.pot` and no `execution.engine`, the builder uses the
same Pot the [native syntax](#the-destination-pot-is-derived) derives — CREATE2 from the released
Kitchen over that Executor and salt zero (`SAUCE_INTENT_POT_SALT`) — and the released engine. That is
the one Pot the solver deploys per Portal and every intent through that Portal shares. Both remain
overrides. `destinationPot(Base.chain, { portal })` returns that address, for a `precalls`
transfer into it.

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
(`0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082`) and one derived Pot
(`destinationPot(chain)`, `0xDd330394620fBFF4D0AdcfA33B0D7b3622Db15B0`) serve every destination.
This prediction uses the pinned Kitchen release's Pot bytecode. The Kitchen, the matching engine and
that Pot must be deployed on the destination before an intent to it can run; the release address
alone does not confirm readiness.

A solver fills an intent only on the Portal it serves: an intent published on a different Portal
deployment is not one it can fill. Set `options.portal` or `options.sourcePortal` only to a Portal
you have confirmed a solver serves.

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
import { Base, destinationPot, token, type routes } from "@eco-incorp/sauce";

interface TransferIntentConfig {
  executionFee: bigint;
  destinationPortal: routes.AddressInput;
  baseUsdc: routes.AddressInput;
  recipient: routes.AddressInput;
  source: routes.ChainRef;
  sourcePortal: routes.AddressInput;
  rewardToken: routes.AddressInput;
  rewardAmount: bigint;
  creator: routes.AddressInput;
  prover: routes.AddressInput;
  routeDeadline: bigint;
  rewardDeadline: bigint;
}

export function buildBaseTransfer(config: TransferIntentConfig) {
  const amount = 1_000_000n;
  // The Pot the route cooks on: the shared one for the Portal it records. It must already exist.
  const pot = destinationPot(Base.chain, { portal: config.destinationPortal });
  const delivery = token.Token.transfer({ token: config.baseUsdc, to: pot, amount }).toCall();

  return Base("USDC.transfer(RECIPIENT, AMOUNT);", {
    execution: { value: config.executionFee },
    nativeAmount: config.executionFee,
    portal: config.destinationPortal,
    sourcePortal: config.sourcePortal,
    deadline: config.routeDeadline,
    tokenDefines: { USDC: config.baseUsdc },
    defines: { RECIPIENT: BigInt(config.recipient), AMOUNT: amount },
    tokens: [{ token: config.baseUsdc, amount }],
    precalls: [delivery],
  }).reward({
    source: config.source,
    creator: config.creator,
    prover: config.prover,
    deadline: config.rewardDeadline,
    tokens: [{ token: config.rewardToken, amount: config.rewardAmount }],
  });
}
```

The submission helpers below generate EVM calldata and reject an SVM source, so an intent you submit with them is EVM-sourced. Its **destination** may be Solana — the encoding supports it — but see the [Solana guide](solana.md) for how that execution is actually built.

The route has two calls: the delivery into the Pot, and the cook.
`executionFee` is the destination Kitchen quote obtained above. The source reward must separately compensate the solver for delivery, fees, and gas; the SDK does not price it.

The explicit `tokenDefines` ensures that the token transferred into the Pot matches the token used by the program. To use the SDK's default Base USDC, resolve it with `routes.registryTokenAddress(Base.chain, "USDC")` and check the result before building. That lookup returns a `bigint`; convert it to a 20-byte hex address with Viem's `toHex(value, { size: 20 })` for intent token fields, as in the [complete example](../examples/first-intent.ts).

## Create an intent from inside a program

Everything above builds an intent in TypeScript, before anything runs. A program can also create one
_while_ it is running, which is what you want when the amount is the output of the step before it:

```js
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
```

Same shape as the TypeScript builder, written in the program. No Portal, prover, selector, encoding
or approval appears, because none of them is a decision you are making. The closest TypeScript form
is a [dynamic nest](nested-intents.md#create-the-child-on-chain-from-a-measured-amount), where you
build a placeholder child, name the measurement and count each placeholder's occurrences yourself.

### The braces are a Sauce program

Anything a route body can do belongs in there: protocol calls, control flow, locals, and an intent
of its own. There are two lowerings and the SDK picks between them, which matters to you because
they cost different things.

| The body is…                    | Becomes…                                               | Needs                   |
| ------------------------------- | ------------------------------------------------------ | ----------------------- |
| only token `transfer`/`approve` | plain `route.calls` the Portal's Executor runs         | nothing further         |
| anything else                   | a program compiled for the destination, run on its Pot | a Pot and a Kitchen fee |

The first shape is free: a route already _is_ a list of calls, so a cook would only add a fee. The
second is strictly more general.

A body takes the first shape only when **every** statement in the braces is a
`transfer(to, amount)` or `approve(spender, amount)` call, on a registered token symbol such as
`USDC` or on `Token(address)` with a literal or compile-time address, and each argument is a
literal, a compile-time define, or a variable of the enclosing program. A single statement of any
other kind — a local, a balance read, a condition, a loop, a `transferFrom`, a protocol call, an
intent of its own — makes the whole body a program.

#### Token-only bodies run on the Executor

A token-only body is not a Sauce program. The Portal's Executor runs each call itself, and checks
only that the call did not revert and that the target has code. It does not decode what a token
returns:

- **USDT is fully supported.** A token that returns nothing from `transfer` or `approve` works.
  Every `approve` becomes two calls, `approve(spender, 0)` and then `approve(spender, amount)`,
  because USDT refuses to change one non-zero allowance to another and one Executor runs every
  intent on a chain, so an earlier intent's allowance may still be standing. A transfer stays one
  call. The reset adds about 8,000 gas per approve.
- **A token that returns `false` instead of reverting is not detected.** The tokens the solver
  delivers are pulled by the Portal with OpenZeppelin's `safeTransferFrom`, so one that returns
  `false` fails delivery. But when the Executor's own `transfer` or `approve` returns `false`, the
  intent is still fulfilled, with nothing moved.

For full `SafeERC20` checks, make the body a program by adding any statement that is not a token
write, such as `const held = USDC.balanceOf(ctx.self());`. A program's token writes are
[`SafeERC20`](protocols-and-tokens.md#writes-follow-safeerc20), and a `false` return reverts the
fulfilment. A program needs the destination's Kitchen fee and a deployed Pot, as the table says,
and the solver's delivery named in the second argument, because it is not derived for a program
(see below).

```js
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(
    () => {
      const here = USDC.balanceOf(ctx.self());
      if (here > 0n) {
        USDC.transfer(RECIPIENT, here);
      }
    },
    { tokens: [{ token: USDC, amount }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}
```

**The second argument names what the solver delivers** so the body has something to work with, and
the lowering adds the Executor-to-Pot transfer. For the token-only shape it is derived instead — a
`transfer` of N moves N, so N is what has to arrive. It is _not_ derived for a program, and that is
a judgement rather than an omission: a program's `balanceOf` reads what is _there_, which may be what
an earlier call in the same route produced rather than what a solver must bring. Inferring an
obligation from it would silently under- or over-state what the intent asks for, and an intent that
asks for the wrong delivery is unfulfillable or overfunded.

### Captured variables

`amount` is a local of the enclosing program, so its value does not exist when the intent is
encoded. It is encoded with a sentinel in its place and the program splices the real value in as it
runs. Any scalar works — an amount, an address, anything one 256-bit word wide.

A variable can arrive two ways, and the same variable can do both:

- **Into the encoded intent** — a route call's argument, a reward amount, a delivery amount. One
  slot per variable, however many of those it fills, so they are the same number by construction
  rather than by several encodings agreeing.
- **Into the child program** — it becomes one of that program's entry arguments, encoded at a
  declared width so its offset does not move, and spliced into the cook's calldata.

Used both ways, a variable gets a slot in each: they are different offsets carrying the same value.

### The file's functions, imports and constants

A program body was written in the file, so it can use what the file declares: its functions, its
imports, its interfaces and its module-level constants. Its program carries the ones the body
reaches, and the ones those reach, as written, and nothing else:

```ts
import { balanceOf } from "@sauce/token";

function fee(amount: Uint256): Uint256 {
  return amount / 100n;
}

function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(
    () => {
      const [held] = abi.decode(abi.encode(balanceOf(USDC, ctx.self())), ["Uint256"]);
      USDC.transfer(RECIPIENT, held - fee(held));
    },
    { tokens: [{ token: USDC, amount }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
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

An intent inside an intent is lowered recursively — the child is compiled by re-entering the same
pipeline, so it gets its own chain's names and this same lowering, at any depth. That is how a chain
of hops whose amounts are each measured on arrival is written; see
[nested intents](nested-intents.md#a-cascade-in-native-syntax).

### Names resolve per chain

Two chains meet in `Arbitrum(() => { ... }).reward({ ... })`, and each part belongs to one of them.
A token symbol resolves on the chain where its part runs:

| Part                                   | Runs on                       | `USDC` is    |
| -------------------------------------- | ----------------------------- | ------------ |
| The braces                             | Arbitrum, the destination     | Arbitrum's   |
| The second argument, what is delivered | Arbitrum, the destination     | Arbitrum's   |
| `.reward(...)`                         | The chain the program runs on | That chain's |

The reward belongs to the enclosing chain because the program escrows it there: it pays the reward
token into the intent's vault on that chain's Portal and publishes the intent in the same
fulfillment. Resolving a name on the other chain names an address that is not that token where it
is used. A reward token taken from the destination fails the transfer's code check and reverts the
fulfillment. A body token taken from the enclosing chain makes the intent unfulfillable.

The rule repeats at every depth. An intent opened inside a body is funded on that body's chain, so
its reward resolves there and its own body on its own destination. The same holds for the other
values that belong to a chain, `chainId` and protocol addresses such as `UniswapV4_UniversalRouter`:
a body on another chain sees that chain's own.

A literal address means that address wherever it appears, and so does a compile-time define whose
name no chain uses, such as `RECIPIENT`. A define or a `tokens` override under a chain-scoped name —
a token symbol, `chainId`, a protocol address — is a name on the chain the program is compiled for.
It applies to that program and to the reward it funds. A body on another chain keeps that chain's
value, whether the define came from `chainDefines(base)` or was chosen by hand.

### A throw reverts everything

A `throw` or a failed `require` in a program, and every guard the SDK emits, reverts the whole
fulfillment — no earlier route call survives it. A program that refuses to create an intent
therefore leaves nothing behind, and a measurement below its floor cannot strand funds in the Pot.

### Where each value comes from

| Value              | Comes from                                                        |
| ------------------ | ----------------------------------------------------------------- |
| Portal, both sides | The eco-routes deployment tables, by chain                        |
| Prover             | The tables, by source/destination pair                            |
| Destination Pot    | Derived — see below                                               |
| Engine             | The released engine address                                       |
| Destination        | The chain you named                                               |
| Source             | The chain the program runs on                                     |
| Deadline           | **You.** Too early is unfulfillable, too late locks the reward up |
| Creator            | **You.** See below                                                |
| Execution fee      | **You**, for a program body. See below                            |

The **creator** is the address that may reclaim the reward if nobody earns it. The executing Pot is
the obvious default and the wrong one: it is owned by the Portal's Executor, which every solver can
drive, so a refund landing there is a refund anyone can take. Set `IntentOptions.creator` and every
intent the program creates inherits it, along with the deadline and the eco-routes deployment; a
direct `compileSauceRoute` caller sets `compile.intents.creator`.

The **execution fee** is the one value that cannot be derived. It is mutable on-chain, and it lives
on the destination, which the source chain cannot read while it executes. Read it at build time and
pass it as `compile.intents.executionFee`:

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
when the Executor calls an address without code. A token-only body cooks nothing, so it needs no Pot.

A Pot you name with `pot` must equally exist already and be owned by that Executor.

Because it is shared, **leave nothing in it**. Deliver assets, use them, and move the remainder out
within the same fulfillment. Anything resting there, or any allowance left standing, belongs to
whoever drives the Executor next.

### Overrides

Everything derived can be overridden through `compile.intents`, and `Base(...)` passes its own
fields down so the common case sets none of them:

| Field                        | Overrides                                                            |
| ---------------------------- | -------------------------------------------------------------------- |
| `deadline`, `rewardDeadline` | The route and reward deadlines                                       |
| `creator`, `prover`          | The reward's creator and prover                                      |
| `sourcePortal`               | Where the intent is published                                        |
| `destinationPortal`          | The Portal recorded in the child's route                             |
| `pot`, `engine`              | Where a program body cooks, and on what; a named Pot is not deployed |
| `executionFee`               | The cook's value                                                     |
| `fundVia`                    | How the reward is funded — see below                                 |
| `salt`, `allowPartial`       | The route salt, and partial funding (`publishAndFund` only)          |
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

`fundVia: "publishAndFund"` — in `compile.intents`, `IntentOptions.fundVia`, or
`--intent-fund-via publishAndFund` on the command line — approves the Portal for each reward token
instead (resetting a standing allowance first) and calls `publishAndFund`, forwarding the native
amount as the call's value. The Portal pulls the reward into the same vault, records the intent
`Funded` and emits `IntentFunded`. Choose it when something you rely on reads that event or status
rather than the vault's balance. `allowPartial` applies only here.

### What is refused

Each of these is a compile error naming the construct, never a silently different intent:

- An identifier that is neither a compile-time value nor a variable of the enclosing program.
- A `.reward(...)` that is not an object, or a token entry missing `token` or `amount`.
- A missing `deadline`, a missing `creator`, or a missing `executionFee` for a program body.
- A chain with no eco-routes deployment, or a pair with no prover deployed on both sides.
- A program body that calls the function opening it.

Inside a program body an unknown name is the _compiler's_ error rather than this lowering's, and
reads the same way: it names the variable that is not declared.

## Callbacks are compiled source

A callback is read with `Function.prototype.toString()`, parsed, and compiled as SauceScript. It is never invoked as a JavaScript callback and captures no outer variables. An `amount` in surrounding JavaScript does not become a value inside the program.

Use literals for self-contained callbacks, or source strings plus `defines` for application inputs, as above. Defines accept scalar `bigint`, `number`, or `boolean` values; use `bigint` for addresses and token quantities. `compile.defines` overrides `options.defines`, which overrides chain defaults. Local declarations in the program take precedence over ambient names.

The package declares SauceScript's builtins for TypeScript — `ctx`, `crypto.keccak256`, `hex`, `Math.mulDiv`, `require(condition, message)`, `abi`, `evm`, `svm`, `.toBytesBe(...)` and the rest of the [reference](../../skills/sauce-script/references/builtins.md) — as it declares token symbols and protocols, so a typed callback that uses them typechecks. The declarations install nothing at run time, and a builtin's comment says which targets have it: TypeScript does not know which chain the callback compiles for.

Callbacks must be synchronous and take no parameters. Bound/native functions, generators, and async functions are rejected. If a bundler transforms function source, ship an explicit SauceScript string or source asset. A TypeScript type declaration does not create a captured value.

A function the callback declares in its own body is a helper of the program: SauceScript has no nested functions, so it is declared beside `main`, and an intent opened inside the callback can call it like any other function of the file. Its annotations are whatever the host's TypeScript compilation left in the callback's text, which is usually none, so a helper that takes or returns an array or a record belongs in a source string.

`Base(...)` adds the SDK's default ambient token module, enabling function forms such as `approve(tokenAddress, spender, amount)`. Direct `compileSauceRoute(...)` does not automatically add that ambient module. The token and protocol member syntax described in [protocols and tokens](protocols-and-tokens.md) is a separate rewrite that works on both paths; its writes import the same module's functions themselves, so they have the same `SafeERC20` semantics either way.

## Submit the source reward

For a built intent, prepare the source-chain requests:

```ts
import type { routes } from "@eco-incorp/sauce";

export async function sourceTransactions(
  built: routes.BuiltIntent,
  ethCall: (request: Pick<routes.PortalReadCall<routes.Hex>, "to" | "data">) => Promise<routes.Hex>,
) {
  const read = built.vaultCall();
  const vault = read.decode(await ethCall({ to: read.to, data: read.data }));
  return built.sourceTxs({ vault });
}
```

Each request is `{ to, data, value }`. Send them from the intended funder on `built.source`, in order. By default an intent is funded **by transfer to its vault**: one ERC-20 `transfer` per reward token to the vault (for the largest amount listed for it), a plain send of the native amount, then `Portal.publish`. The Portal counts an intent funded when its vault holds the reward (`isIntentFunded`), and that is what a solver checks after it sees `IntentPublished`. No approval is asked for, so none is left standing and a USDT-style token needs no reset. `sourceTxs()` covers only the root reward, even when the intent has children.

**Pass the vault you read.** `vault` is checked against `predictVault()`, the SDK's own derivation, and a mismatch throws `IntentVaultMismatchError` before anything is built: a transfer is final, so an address two sources disagree on is not paid. Without `vault`, the derivation alone is used. It is held to the `intentVaultAddress` of every eco-routes Portal the SDK records.

**Send the transfers first, and publish once they have landed.** The solver then sees `IntentPublished` with the vault already funded. If `publish` fails, the reward stays in the vault: publish again later, or refund it after the reward deadline. A token whose `transfer` returns `false` instead of reverting leaves the vault short, so check `fundedCall()` before sending `publish`. [`sauce intent publish`](cli.md#intents-sauce-run-or-sauce-intent) does all of this for you.

`sourceTxs({ fundVia: "publishAndFund" })`, or `IntentOptions.fundVia: "publishAndFund"`, returns `[...approvals(), publishAndFundCalldata(allowPartial)]` instead. ERC-20 approvals authorize the **source Portal**, which pulls tokens into the vault, records the intent `Funded` and emits `IntentFunded`. Native rewards are included as transaction `value`. Wait for successful approvals before funding. `allowPartial` defaults to `false`; use partial funding only when the application deliberately supports it. Choose this mode when something you rely on reads the `IntentFunded` event or the `Funded` status rather than the vault's balance.

`publishCalldata()` publishes without funding, and `fundCalldata(allowPartial)` funds separately. These methods do no RPC and send no transactions.

Set `sourcePortal` while building, or pass `{ portal: sourcePortal }` to each helper. The destination `portal` is never silently reused as the submission target.

## Rehearse the fill on the destination

Publishing proves the reward is escrowed, not that the intent works. Its body runs on the
destination, inside the solver's fill, so a swap that falls short of its minimum or a refund that
fails shows up only there. A solver sends two things on the destination chain:

- an approval of the destination Portal for each token the route delivers, which the Portal pulls
  from the solver into its Executor;
- `Portal.fulfill(intentHash, route, rewardHash, claimant)`, with `route.nativeAmount` as its value
  — the Kitchen's fee for each cook in the route, plus any native the calls spend.

`routes.fulfillApprovalTxs(built.intent)` and `routes.fulfillTx(built.intent, { claimant })` build
them, for an EVM destination:

```ts
import { routes } from "@eco-incorp/sauce";

export function solverTransactions(built: routes.BuiltIntent, claimant: routes.Hex) {
  return [...routes.fulfillApprovalTxs(built.intent), routes.fulfillTx(built.intent, { claimant })];
}
```

Rehearse them before publishing. A route that cooks needs the shared Pot deployed first, so a
rehearsal on a chain where nobody has deployed it yet puts `Kitchen.deployPot(executor, 0)` ahead
of the fill, in the same simulated block. From the command line,
[`sauce intent fill`](cli.md#rehearsing-the-fill-sauce-intent-fill) does all of it with no key: it
builds the file's intents as `sauce intent publish` does, gives a solver the route's tokens by
state override, runs the deployment, the approvals and the fill in one `eth_simulateV1` block on
the destination, and prints what moved, what the shared Pot and the Executor were left holding, and
the decoded reason when it reverts. With `--send` and a signer it then sends them, the signer being
the solver ([`fill --send`](cli.md#filling-it-for-real-sauce-intent-fill---send)).

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

export function afterTheFill(
  intent: routes.Intent,
  sourcePortal: routes.Hex,
  prover: routes.Hex,
  fee: bigint,
) {
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
send them, reading the state first and saying why not, and
[`sauce intent status`](cli.md#after-the-fill-prove-claim-refund-cancel) reads where an intent
stands on both chains. `routes.intentFromPublished(log, sourceChainId)` rebuilds an intent from its
`IntentPublished` log, which `sauce intent import` stores.

## Inspect hashes, vaults, and status

`built.hash()` returns `intentHash`, `routeHash`, and `rewardHash`. `built.intent` or `.root()` returns the normalized intent. `.intents()` returns the root and descendants in preorder; it does not imply they execute atomically across chains.

Read helpers return a request plus its decoder:

```ts
import type { routes } from "@eco-incorp/sauce";

export async function readVault(
  built: routes.BuiltIntent,
  ethCall: (request: Pick<routes.PortalReadCall<routes.Hex>, "to" | "data">) => Promise<routes.Hex>,
) {
  const request = built.vaultCall();
  const result = await ethCall({ to: request.to, data: request.data });
  return request.decode(result);
}
```

Execute this read on the source chain. `hashCall()` cross-checks hashes against the Portal; `fundedCall()` checks funding. `predictVault()` is the offline CREATE2 prediction of the same address, with nothing read from a chain: an eco-routes Portal's vaults are clones, salted with the intent hash, of a Proxy over the Portal's first `CREATE`, so the address follows from the Portal's own. For a Portal built some other way, pass its configuration: `predictVault({ portal, vaultInitCodeHash })`.

For a Solana destination, build the execution with the Kitchen client rather than the SVM route helpers: the instruction those helpers emit is not one the Solana engine accepts, and staging the code does not change that. The [Solana guide](solana.md) has the supported path.
