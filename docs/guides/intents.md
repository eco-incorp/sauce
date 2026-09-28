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

The SDK builds the intent and the transaction requests. It sends nothing. Your application supplies
the deployments, funds the reward, submits the transactions, and a solver fulfills the destination.

## Source, destination, and funding

An intent has two sides:

| Field                                    | Meaning                                                           |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `Base(...)`                              | Destination chain where the Sauce program executes                |
| `options.portal`                         | Destination Portal recorded in the route                          |
| `options.pot`, `options.engine`          | Destination Pot and interpreter used by `cook`                    |
| `options.tokens`, `options.nativeAmount` | Destination assets delivered by the solver to the Portal Executor |
| `reward.source`                          | Chain where the reward is funded                                  |
| `options.sourcePortal`                   | Source Portal used by submission and read helpers                 |
| `reward.tokens`, `reward.nativeAmount`   | Source assets offered as the reward                               |
| `reward.creator`, `reward.prover`        | Creator and prover recorded in the reward                         |

Destination route assets initially arrive in the **Executor**. The Sauce program executes in the **Pot**. For an ERC-20 program that spends solver-delivered assets, prepend a token transfer from the Executor to the Pot. Native value reaches the Pot through `execution.value`; declaring `nativeAmount` alone does not forward it into `cook`.

Every EVM `cook` must receive the Kitchen's current `executionFee()` in native wei, including ERC-20-only programs. Set `execution.value` to **fee + native assets the program needs**, and budget `nativeAmount` for the route's calls. The Pot remits the fee before executing; its existing balance cannot replace this payment. Nested transfer programs add another cook and fee. Read the fee before building; an increase before fulfillment can make the route revert.

Deadlines are absolute Unix timestamps in seconds. `route.deadline` limits destination fulfillment. `reward.deadline` allows source refunds when no valid proof exists; leave time for fulfillment and proof delivery before it.

## Prepare the destination Pot

For direct Portal routes, the Pot's owner must be the destination **`Portal.executor()`**. A user-owned or solver-owned Pot rejects the Executor's call with `NotOwner()`.

`IntentOptions.execution.pot` is still supplied by the caller on this path — the builder does not
derive it, because the Pot a route cooks on is also where its assets pass through, and that is a
custody decision worth making explicitly. `v12PredictPot(ecoRoutesExecutor(chain))` gives the same
canonical address the native syntax derives, if that is the one you want.

Use [evm-execution.ts](../examples/evm-execution.ts) on the destination chain to read the Executor, resolve the current Kitchen and engine, predict the Pot, and quote the execution fee. If the Pot is absent, the helper returns a deployment request. Send it, wait for a successful receipt, and run the helper again. Only use a result with `ready: true`, which confirms code is present and checks the Pot's `owner()` and `kitchen()`.

The deployment helpers return the released addresses. They do not check that code is live at those addresses on your chain — the helper above does, which is why its `ready: true` is the signal to act on.

An Executor-owned Pot can be invoked by other valid Portal routes. Deliver assets, use them, and return leftovers **within the same fulfillment**; do not leave user funds or standing allowances in it. Source reward escrow belongs in the intent vault. These caller and custody rules follow [Eco Routes' Executor calls](https://github.com/eco/eco-routes/blob/49de5bb10a5eb00509b21702df6cf54de448ee11/contracts/Executor.sol#L50-L74) and [destination fulfillment](https://github.com/eco/eco-routes/blob/49de5bb10a5eb00509b21702df6cf54de448ee11/contracts/Inbox.sol#L225-L271).

## Build a Base USDC transfer intent

This function takes deployment and reward configuration as inputs. It delivers one USDC on Base to `recipient` and offers the configured source-token reward. It only constructs data.

```ts
import { Base, token, type routes } from "@eco-incorp/sauce";

interface TransferIntentConfig {
  pot: routes.AddressInput;
  engine: routes.AddressInput;
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
  const delivery = token.Token.transfer({
    token: config.baseUsdc,
    to: config.pot,
    amount,
  }).toCall();

  return Base("USDC.transfer(RECIPIENT, AMOUNT);", {
    execution: { pot: config.pot, engine: config.engine, value: config.executionFee },
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

Same shape as the TypeScript builder, written in the program. No Portal, selector, encoding or
approval appears, because none of them is a decision you are making.

### The braces are a Sauce program

Anything a route body can do belongs in there: protocol calls, control flow, locals, and an intent
of its own. There are two lowerings and the SDK picks between them, which matters to you because
they cost different things.

| The body is…                    | Becomes…                                               | Needs                   |
| ------------------------------- | ------------------------------------------------------ | ----------------------- |
| only token `transfer`/`approve` | one `route.calls` entry per statement                  | nothing further         |
| anything else                   | a program compiled for the destination, run on its Pot | a Pot and a Kitchen fee |

The first shape is free: a route already _is_ a list of calls, so a cook would only add a fee. The
second is strictly more general.

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

### Nesting

An intent inside an intent is lowered recursively — the child is compiled by re-entering the same
pipeline, so it gets its own chain's names and this same lowering, at any depth. That is how a chain
of hops whose amounts are each measured on arrival is written; see
[nested intents](nested-intents.md#a-cascade-in-native-syntax).

### Names resolve per chain

`USDC` inside the braces is _Arbitrum's_ USDC, because those calls run on Arbitrum. Resolving it
against the enclosing chain would put one chain's address in another chain's route.

### A throw reverts everything

A `throw` in a program, and every guard the SDK emits, reverts the whole fulfillment — no earlier
route call survives it. A program that refuses to create an intent therefore leaves nothing behind,
and a measurement below its floor cannot strand funds in the Pot.

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
is the destination `Portal.executor()` — itself the Portal's second `CREATE`, so it follows from the
Portal address the registry already has. Nothing is read from a chain and nothing is asked of you.
The salt is a constant, so there is **one canonical Pot per chain** rather than one per intent.

Deriving an address is not deploying a contract. The Pot exists once somebody has called the
Kitchen's `deployPot` for that owner and salt — one permissionless transaction per chain, after
which every intent on that chain shares it. Before that, a cook against it reverts.

Because it is shared, **leave nothing in it**. Deliver assets, use them, and move the remainder out
within the same fulfillment. Anything resting there, or any allowance left standing, belongs to
whoever drives the Executor next.

### Overrides

Everything derived can be overridden through `compile.intents`, and `Base(...)` passes its own
fields down so the common case sets none of them:

| Field                        | Overrides                                |
| ---------------------------- | ---------------------------------------- |
| `deadline`, `rewardDeadline` | The route and reward deadlines           |
| `creator`, `prover`          | The reward's creator and prover          |
| `sourcePortal`               | Where the intent is published            |
| `destinationPortal`          | The Portal recorded in the child's route |
| `pot`, `engine`              | Where a program body cooks, and on what  |
| `executionFee`               | The cook's value                         |
| `salt`, `allowPartial`       | The route salt, and partial funding      |
| `generation`, `environment`  | Which eco-routes deployment to address   |

### What is refused

Each of these is a compile error naming the construct, never a silently different intent:

- An identifier that is neither a compile-time value nor a variable of the enclosing program.
- A `.reward(...)` that is not an object, or a token entry missing `token` or `amount`.
- A missing `deadline`, a missing `creator`, or a missing `executionFee` for a program body.
- A chain with no eco-routes deployment, or a pair with no prover deployed on both sides.

Inside a program body an unknown name is the _compiler's_ error rather than this lowering's, and
reads the same way: it names the variable that is not declared.

## Callbacks are compiled source

A callback is read with `Function.prototype.toString()`, parsed, and compiled as SauceScript. It is never invoked as a JavaScript callback and captures no outer variables. An `amount` in surrounding JavaScript does not become a value inside the program.

Use literals for self-contained callbacks, or source strings plus `defines` for application inputs, as above. Defines accept scalar `bigint`, `number`, or `boolean` values; use `bigint` for addresses and token quantities. `compile.defines` overrides `options.defines`, which overrides chain defaults. Local declarations in the program take precedence over ambient names.

Callbacks must be synchronous and take no parameters. Bound/native functions, generators, and async functions are rejected. If a bundler transforms function source, ship an explicit SauceScript string or source asset. A TypeScript type declaration does not create a captured value.

`Base(...)` adds the SDK's default ambient token module, enabling function forms such as `approve(tokenAddress, spender, amount)`. Direct `compileSauceRoute(...)` does not automatically add that ambient module. The token and protocol member syntax described in [protocols and tokens](protocols-and-tokens.md) is a separate rewrite.

## Submit the source reward

For a built intent, prepare the source-chain requests:

```ts
import type { routes } from "@eco-incorp/sauce";

export function sourceTransactions(built: routes.BuiltIntent) {
  return [...built.approvals(), built.publishAndFundCalldata(false)];
}
```

Each request is `{ to, data, value }`. Send them from the intended funder on `built.source`, in order, waiting for successful approvals before funding. ERC-20 approvals authorize the **source Portal**, which pulls tokens into the intent vault. Native rewards are included as transaction `value`. `.approvals()` covers only the root reward, even when the intent has children.

`false` selects full funding; use partial funding only when the application deliberately supports it. `publishCalldata()` publishes without funding, and `fundCalldata(allowPartial)` funds separately. These methods do no RPC and send no transactions.

Set `sourcePortal` while building, or pass `{ portal: sourcePortal }` to each helper. The destination `portal` is never silently reused as the submission target.

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

Execute this read on the source chain. `hashCall()` cross-checks hashes against the Portal; `fundedCall()` checks funding. `predictVault({ portal, vaultInitCodeHash })` provides an offline CREATE2 prediction when you have verified the deployed vault configuration.

For a Solana destination, build the execution with the Kitchen client rather than the SVM route helpers: the instruction those helpers emit is not one the Solana engine accepts, and staging the code does not change that. The [Solana guide](solana.md) has the supported path.
