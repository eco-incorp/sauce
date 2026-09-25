# Create and fund an Eco intent

[Documentation](../README.md) · [Routes API](../api/routes.md) · [Nested intents](nested-intents.md)

`Base(body, options).reward(reward)` compiles a program for Base and packages it as an Eco intent. `Base.route(...)` has the same behavior. The destination chain selects the compiler target, token addresses, and protocol deployments.

```ts
import "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

export function buildApprovalIntent(routeOptions: routes.IntentOptions, reward: routes.RewardArg) {
  return Base(() => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  }, routeOptions).reward(reward);
}
```

The SDK constructs the intent and transaction requests. Your application supplies deployments, funds the source reward, submits transactions, and arranges fulfillment by a solver.

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

Use [evm-execution.ts](../examples/evm-execution.ts) on the destination chain to read the Executor, resolve the current Kitchen and engine, predict the Pot, and quote the execution fee. If the Pot is absent, the helper returns a deployment request. Send it, wait for a successful receipt, and run the helper again. Only use a result with `ready: true`, which confirms code is present and checks the Pot's `owner()` and `kitchen()`.

Deployment helpers return release addresses; the historical chain roster does not attest current release liveness.

An Executor-owned Pot can be invoked by other valid Portal routes. Deliver assets, use them, and return leftovers **within the same fulfillment**; do not leave user funds or standing allowances in it. Source reward escrow belongs in the intent vault. These caller and custody rules follow [Eco Routes' Executor calls](https://github.com/eco/eco-routes/blob/49de5bb10a5eb00509b21702df6cf54de448ee11/contracts/Executor.sol#L50-L74) and [destination fulfillment](https://github.com/eco/eco-routes/blob/49de5bb10a5eb00509b21702df6cf54de448ee11/contracts/Inbox.sol#L225-L271).

## Build a Base USDC transfer intent

This function takes deployment and reward configuration as inputs. It delivers one USDC on Base to `recipient` and offers the configured source-token reward. It only constructs data.

```ts
import { token, type routes } from "@eco-incorp/sauce";

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

Use an EVM source when using the Portal submission helpers below; they generate EVM calldata and reject an SVM source. The route model can represent SVM destinations, but the current SVM route emitter is incompatible with the released gated engine.

`executionFee` is the destination Kitchen quote obtained above. The source reward must separately compensate the solver for delivery, fees, and gas; the SDK does not price it.

The explicit `tokenDefines` ensures that the token transferred into the Pot matches the token used by the program. To use the SDK's default Base USDC, resolve it with `routes.registryTokenAddress(Base.chain, "USDC")` and check the result before building. That lookup returns a `bigint`; convert it to a 20-byte hex address with Viem's `toHex(value, { size: 20 })` for intent token fields, as in the [complete example](../examples/first-intent.ts).

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

The current SVM route emitter produces an older direct-engine instruction and cannot target the released gated engine. Code staging alone does not make those routes executable. See the [Solana guide](solana.md) for supported Kitchen execution and route-helper limitations.
