# Builders

[Documentation](../README.md) · [Protocol calls](protocols-and-tokens.md) · [Compiler](../api/compiler.md)

Sometimes a program is not something you write — it is something your application assembles from
data it already has: a token and an amount, a pool and a direction, a vault and a deposit. The
builders on this page take that data and emit SauceScript source you compile like any other program.

They emit source. They do not pick a market route, quote a price, or send anything. The ABIs that
source imports ship inside the SDK, and route compilation serves them itself, so the output compiles
with no resolver option.

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
  return routes.compileSauceRoute("base", program.source, execution);
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
`approve`) behave the same way, and so does the route-body syntax — `USDC.transfer(...)`,
`Token(address).approve(...)` — which compiles to those functions. Only an ABI binding you write
yourself, `IERC20.at(address).transfer(...)`, is the raw unchecked call; see
[protocols and tokens](protocols-and-tokens.md#writes-follow-safeerc20).

The visible consequence is that a literal amount is encoded into the calldata rather than appearing
as a decimal in the emitted source.

`TokenCall.toCall()` instead returns `{ target, data, value }` for a fixed EVM call. Values that require runtime state, such as `amount: "balance"` or balance owner `"self"`, must be compiled. `.statement(target)` emits a transfer/approval statement; `.expression(target)` emits a balance read. `Token.program(specs, { target })` combines several operations into one program.

Use `Token.approve({ token, spender, amount })` for approvals and `Token.balanceOf({ token, owner })` for reads. SVM specs name account references instead of ERC-20 addresses; see [Solana](solana.md).

## Swaps

`swap.swapSource(spec)` generates a program calling the Sauce Router's unified swap entry point. `swap.swapSource([legA, legB])` emits multiple swaps in one program. `swap.toSwapParams(spec)` exposes the normalized parameters, and `swap.swapCallStatement(spec)` produces a statement for composition.

```ts
import { routes, swap } from "@eco-incorp/sauce";

export function compileSwap(spec: swap.SwapSourceSpec, execution: routes.SauceEvmExecutionInput) {
  return routes.compileSauceRoute("base", swap.swapSource(spec), execution);
}
```

Supply the correct pool, tokens, amount, and pool-specific parameters. The generated program self-calls the Sauce Router path supported by the Pot; the execution deployment must support it. The unified builder supports `UniV2`, `UniV3`, `UniV4`, `Curve`, `BalancerV2`, `DODOV2`, `TraderJoeLB`, `MaverickV2`, and `WOOFi`. The separate Pancake Infinity CL/Bin entry points are not supported by this builder. `Curve` through the Router needs a pool whose `exchange` returns the amount out: the Router decodes a `uint256` from it, and a 3pool-era pool returns nothing, so the swap reverts — call such a pool directly instead.

Every swap is **exact input**: `amountIn` is what the Pot pays. The builder turns it into each pool type's sign convention (positive for `UniV3`, negative for `UniV4`, as-is for the rest) and refuses an amount of 2^255 or more, which would read as exact output. There is no exact-output form: the Router caps what a V3-family or Maverick callback may take at the exact input, and an exact-output swap names no input maximum. `amountIn: "balance"` swaps the Pot's whole `tokenIn` balance, read when the swap runs, under the same convention — negated for `UniV4` — on every pool type.

Synthra V3 and UnitFlow V3 pools dispatch as `UniV3`, but they call back under their own names (`synthraV3SwapCallback`, `unitFlowV3SwapCallback`), which only a generation-3 Router answers. Name such a pool with `venue` and pass the executing Pot's Router generation as `routerGeneration`; the builder refuses an older or unstated Router rather than emit a swap that reverts.

A Pot runs the Router it was minted with until its owner moves it, so its generation is a property of the Pot, not of the chain. When `potRouterUpdate(client, pot)` from `@eco-incorp/sauce/evm/engine` returns nothing, the Pot runs its Kitchen's current Router, whose generation is `v12RouterGeneration()` from `@eco-incorp/sauce/deployments`. Otherwise it returns the Pot's `setRouter` call, which only the Pot's owner can send; see [pot-router.ts](../examples/pot-router.ts) and [the Pot's Router](../concepts/architecture.md#a-pots-router).

```ts
import { swap } from "@eco-incorp/sauce";
import { v12RouterGeneration } from "@eco-incorp/sauce/deployments";

export function synthraSwap(spec: Omit<swap.SwapSpec, "poolType" | "venue">) {
  return swap.swapSource(
    { ...spec, poolType: swap.SwapPoolType.UniV3, venue: "synthra-v3" },
    { routerGeneration: v12RouterGeneration() },
  );
}
```

The builder does not recover and expose a general `amountOut` value from the swap return. Enforce the intended output with an explicit balance/delta check or a settlement program. A program compiling successfully does not demonstrate correct execution against a specific live pool.

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
  return routes.compileSauceRoute("base", source, execution);
}
```

The default approval policy is `"exact"`; `"none"` assumes an existing allowance, and `"max"` grants the maximum allowance. The default beneficiary is the executing contract where the protocol supports it. Native-funded templates require value in the executing Pot and use a call carrying native value.

`amount: "balance"` reads the executing Pot's balance: native ETH for native-funded templates, the WETH `target` for unwrapping, or the supplied `token` for other templates. `deposit.swapThenDepositSource(...)` composes swaps and deposits and also supports `amount: "delta"` for the increase in that balance across the swap block. Standalone deposit source cannot use `"delta"` because it lacks the pre-swap snapshot.

On Arc the native coin is USDC at 18 decimals, and it is also the 6-decimal ERC-20 at `0x3600…0000`; a native-funded template's `"balance"` is that 18-decimal figure. Arc has no canonical wrapped native, so the `weth` templates have nothing to target there: `toDeposit` rejects Arc's `USDC` and its registry tokens, whose `WETH` is bridged ETH, as a `weth` target. See [Arc: USDC is the native coin](../api/coverage.md#arc-usdc-is-the-native-coin).

For Aave/Spark withdrawals, use a fixed underlying-asset amount or `amount: "max"` to withdraw the full position. `"balance"` and `"delta"` read the underlying token held by the Pot, not its supplied position, and should not size a withdrawal.

## Routing actions

Higher-level routing actions — swaps, bridges, wraps, stakes, and the chaining between them — live
behind the package's `/actions` subpath and are documented in [Actions](actions.md). An action
program is plain JSON that compiles to one program; `programIntent(program, options)` makes it
the route of an [intent](intents.md) directly.
