# Builders

[Documentation](../README.md) · [Protocol calls](protocols-and-tokens.md) · [Compiler](../api/compiler.md)

Sometimes a program is not something you write — it is something your application assembles from
data it already has: a token and an amount, a vault and a deposit. The builders on this page take
that data and emit SauceScript source you compile like any other program.

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

A swap is not a builder: it is a call into [`@sauce/router`](../api/router.md), the SauceScript
library with one function per venue — Uniswap V2, V3 and V4, Curve, Balancer V2, DODO V2, Trader Joe
LB, WOOFi and Maverick V2. Its functions take the pool, tokens and amount as run-time arguments, so
a program can spend what an earlier call returned, or choose the venue while it runs, and each
returns what it received. Write the call into your program:

```js
import { uniswapV3 } from "@sauce/router";

function main(recipient: Address) {
  uniswapV3(POOL, WETH, USDC, AMOUNT_IN, 0, MIN_OUT, recipient);
}
```

The last argument decides where the output ends: your wallet, or `ctx.self()` to keep it in the Pot,
where only another cook moves it
([Where a program's results end](../concepts/kitchen-pot-cook.md#where-a-programs-results-end)).

From data, write the swap as a [JSON action](actions.md#swaps) instead — `uniswapV3Swap`,
`curveSwap`, … — which compiles to the same call. An action names its tokens and contracts as a
program does (`"USDC"`, `"UniswapV3.Factory"`), and may name its pool by its factory's key, read
while the program runs: see [pools by key](actions.md#pools-by-key).

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

`amount: "balance"` reads the executing Pot's balance: native ETH for native-funded templates, the WETH `target` for unwrapping, or the supplied `token` for other templates — which is how a deposit spends what a swap before it delivered. To swap and then supply in one program from data, write an [action program](actions.md): a swap action's output is what the next action spends.

On Arc the native coin is USDC at 18 decimals, and it is also the 6-decimal ERC-20 at `0x3600…0000`; a native-funded template's `"balance"` is that 18-decimal figure. Arc has no canonical wrapped native, so the `weth` templates have nothing to target there: `toDeposit` rejects Arc's `USDC` and its registry tokens, whose `WETH` is bridged ETH, as a `weth` target. See [Arc: USDC is the native coin](../reference/chains/arc.md#notes).

For Aave/Spark withdrawals, use a fixed underlying-asset amount or `amount: "max"` to withdraw the full position. `"balance"` reads the underlying token held by the Pot, not its supplied position, and should not size a withdrawal.

## Routing actions

Higher-level routing actions — swaps, bridges, wraps, stakes, and the chaining between them — live
behind the package's `/actions` subpath and are documented in [Actions](actions.md). An action
program is plain JSON that compiles, for a chain, to one program — one document for every chain
where its tokens and contracts exist; `sauce actions` prints what it lowers to.
