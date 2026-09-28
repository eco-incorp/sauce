# Builders and actions

[Documentation](../README.md) · [Protocol calls](protocols-and-tokens.md) · [Compiler](../api/compiler.md)

The SDK provides host-language builders for applications that construct programs from data. Token, swap, and deposit builders produce SauceScript source. The actions package accepts a sequence of routing actions and can produce either source or compiled EVM bytecode. None of these builders selects a market route or submits a transaction.

## Token operations

`token.Token` is a host builder. It takes spec objects, while `Token(address).transfer(...)` is syntax inside a compiled EVM route.

```ts
import { routes, token } from "@eco-incorp/sauce";

export function compileTokenTransfer(
  asset: token.AddressInput,
  recipient: token.AddressInput,
  amount: bigint,
  execution: routes.SauceEvmExecutionInput,
) {
  const operation = token.Token.transfer({ token: asset, to: recipient, amount });
  const program = operation.toSauceScript("evm");
  return routes.compileSauceRoute("base", program.source, execution, {
    baseDirs: [...program.baseDirs],
  });
}
```

Every token WRITE these builders emit — and every one the SDK emits anywhere — carries OpenZeppelin
`SafeERC20` semantics. The call goes out as raw calldata, so nothing decodes a `bool` a token like
USDT never returns, and the result is then checked: empty returndata is accepted only from an
address that has code, and anything else must be exactly `true`. A token that returns `false`
reverts rather than passing silently, and so does a write to an address with no code. `approve` adds
`forceApprove`'s reset — it reads the current allowance and zeroes it first when it is non-zero,
which USDT requires and a shared Pot makes likely.

The visible consequence is that a literal amount is encoded into the calldata rather than appearing
as a decimal in the emitted source.

`TokenCall.toCall()` instead returns `{ target, data, value }` for a fixed EVM call. Values that require runtime state, such as `amount: "balance"` or balance owner `"self"`, must be compiled. `.statement(target)` emits a transfer/approval statement; `.expression(target)` emits a balance read. `Token.program(specs, { target })` combines several operations into one program.

Use `Token.approve({ token, spender, amount })` for approvals and `Token.balanceOf({ token, owner })` for reads. SVM specs name account references instead of ERC-20 addresses; see [Solana](solana.md).

## Swaps

`swap.swapSource(spec)` generates a program calling the Sauce Router's unified swap entry point. `swap.swapSource([legA, legB])` emits multiple swaps in one program. `swap.toSwapParams(spec)` exposes the normalized parameters, and `swap.swapCallStatement(spec)` produces a statement for composition.

```ts
import { routes, swap } from "@eco-incorp/sauce";

export function compileSwap(spec: swap.SwapSourceSpec, execution: routes.SauceEvmExecutionInput) {
  return routes.compileSauceRoute("base", swap.swapSource(spec), execution, {
    baseDirs: [...swap.SWAP_BASE_DIRS],
  });
}
```

Supply the correct pool, tokens, amount, and pool-specific parameters. The generated program self-calls the Sauce Router path supported by the Pot; the execution deployment must support it. The unified builder supports `UniV2`, `UniV3`, `UniV4`, `Curve`, `BalancerV2`, `DODOV2`, `TraderJoeLB`, `MaverickV2`, and `WOOFi`. The separate Pancake Infinity CL/Bin entry points are not supported by this builder.

The builder normalizes each pool type's amount-sign convention. It does not recover and expose a general `amountOut` value from the swap return. Enforce the intended output with an explicit balance/delta check or a settlement program. A program compiling successfully does not demonstrate correct execution against a specific live pool.

## Deposits, withdrawals, staking, and wrapping

`deposit.depositSource(spec)` emits the protocol call and its required approval. Discover supported pairs with `deposit.listDepositTemplates()`; template coverage is separate from the protocol catalog. Templates include Aave/Spark supply and withdrawal, Compound V3 supply, ERC-4626/Euler deposits, Lido operations, and WETH wrapping/unwrapping.

```ts
import { deposit, routes } from "@eco-incorp/sauce";

export function compileSupply(
  pool: deposit.AddressInput,
  asset: deposit.AddressInput,
  amount: bigint,
  execution: routes.SauceEvmExecutionInput,
) {
  const source = deposit.depositSource({
    protocol: "aave-v3",
    action: "supply",
    target: pool,
    token: asset,
    amount,
  });
  return routes.compileSauceRoute("base", source, execution, {
    baseDirs: [...deposit.DEPOSIT_BASE_DIRS],
  });
}
```

The default approval policy is `"exact"`; `"none"` assumes an existing allowance, and `"max"` grants the maximum allowance. The default beneficiary is the executing contract where the protocol supports it. Native-funded templates require value in the executing Pot and use a call carrying native value.

`amount: "balance"` reads the executing Pot's balance: native ETH for native-funded templates, the WETH `target` for unwrapping, or the supplied `token` for other templates. `deposit.swapThenDepositSource(...)` composes swaps and deposits and also supports `amount: "delta"` for the increase in that balance across the swap block. Standalone deposit source cannot use `"delta"` because it lacks the pre-swap snapshot. Use `deposit.COMPOSED_BASE_DIRS` when compiling composed source.

For Aave/Spark withdrawals, use a fixed underlying-asset amount or `amount: "max"` to withdraw the full position. `"balance"` and `"delta"` read the underlying token held by the Pot, not its supplied position, and should not size a withdrawal.

## Routing actions

Import actions from the published package's `/actions` subpath:

```ts
import { actionsToSauce, actionsToSauceSource } from "@eco-incorp/sauce/actions";
import type { RoutingAction } from "@eco-incorp/sauce/actions";

export function buildRoutingProgram(actions: readonly RoutingAction[]) {
  return {
    source: actionsToSauceSource(actions),
    bytecode: actionsToSauce(actions),
  };
}
```

Action variants cover protocol swaps, bridges, wrapping, staking, lending, transfers, and approvals. Each discriminated action specifies concrete addresses and protocol parameters. Keep all actions in a program compatible with the chain where it executes; a `chainId` field does not turn a program into cross-chain execution.

Amount resolution uses this precedence:

1. An explicit amount on the action.
2. `amountRef`, naming a previously saved output.
3. The immediately preceding action's output, for implicit chaining.

Set `saveOutputAs` on an action to name its output for later reuse. Saving an output or implicitly chaining the next action can direct the output to the executing Pot and capture it once. Independent actions retain their configured recipients. Quote helpers such as `actionToQuote` construct protocol quote calls; the application performs and interprets the RPC simulation.

`actionsToSauce` returns a single `Uint8Array`. To put already compiled EVM bytecode into a route, convert it to hex (for example, with Viem's `bytesToHex`) and use `routes.buildSauceEvmCall({ pot, engine, program })`; see the [Routes API](../api/routes.md). To produce an Eco cross-chain intent, build the destination program and use the [intent builder](intents.md).
