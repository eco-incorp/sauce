# Builders

[Documentation](../README.md) · [Protocol calls](protocols-and-tokens.md) · [Compiler](../api/compiler.md)

Sometimes a program is not something you write — it is something your application assembles from
data it already has: a token and an amount, a pool and a direction, a vault and a deposit. The
builders on this page take that data and emit SauceScript source you compile like any other program.

They emit source. They do not pick a market route, quote a price, or send anything.

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
address that has code, and anything else must decode as an ABI word equal to `1`. A token that
returns `false` reverts rather than passing silently, and so do a write to an address with no code
and a return shorter than one ABI word. `approve` adds `forceApprove`'s reset — it reads the current
allowance and zeroes it first when it is non-zero, which USDT requires and a shared Pot makes
likely. The `@sauce/token` functions a program calls directly (`transfer`, `transferFrom`,
`approve`) behave the same way.

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

Higher-level routing actions — swaps, bridges, wraps, stakes, and the chaining between them — live
behind the package's `/actions` subpath and are documented in [Actions](actions.md). An action
program is plain JSON that compiles to one program; `programIntent(program, options)` makes it
the route of an [intent](intents.md) directly.
