---
name: sauce-swaps
description: Swapping inside a Sauce program through the Sauce Router — the flat price-limited entry points swapV3(pool, tokenIn, tokenOut, amountSpecified, sqrtPriceLimitX96, payer, recipient) and swapV4(poolManager, key, zeroForOne, …), the unified swap(SwapParams) with its pool types, the Maverick and PancakeSwap Infinity entry points, which pool families the Router's callbacks service (Uniswap V3 and forks, PancakeSwap V3, Algebra, Synthra, UnitFlow, Uniswap V4), exact-input sign rules, how a price limit produces a partial fill, and the guard that stops a leg from stranding input. Use when the user wants a swap, trade, price limit, sqrtPriceLimitX96, min-out or slippage bound, a partial fill, "swap then …", or asks which venues Sauce can swap on.
---

# Swaps through the Sauce Router

The Router is the Pot's swap surface. A program calls it **through its own Pot**,
`ISauceRouter.at(ctx.self())`: the Pot's fallback delegatecalls the Router it is configured with
(`router()` on the Pot), so the Router runs in the Pot's context, holds the Pot's balances, and its
swap entry points accept only that self-call. Import the ABI the package serves (an intent file
cannot import: there, call the Router by selector, from the table in `sauce-intents`):

```sauce chain=base,arbitrum
import { ISauceRouter } from "./artifacts/ISauceRouter.json";

function main(amount: Uint256, sqrtPriceLimitX96: Uint256) {
  const self = ctx.self();
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500n);
  ISauceRouter.at(self).swapV3(pool, WETH, USDC, amount, sqrtPriceLimitX96, self, self);
}
```

`payer` and `recipient` are the Pot, `ctx.self()`: the swap is paid from the Pot's balance and the
output stays in the Pot, where the program measures it. (A different `recipient` gets the output
forwarded; a different `payer` is pulled from with `transferFrom`.)

## `swapV3` and `swapV4`

| Entry point                                                                                  | Venues                                                                         | Price bound         | Exact input is       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------- | -------------------- |
| `swapV3(pool, tokenIn, tokenOut, amountSpecified, sqrtPriceLimitX96, payer, recipient)`      | any V3-style pool whose callback the Router services (below)                   | `sqrtPriceLimitX96` | positive             |
| `swapV4(poolManager, key, zeroForOne, amountSpecified, sqrtPriceLimitX96, payer, recipient)` | Uniswap V4 pools; `key` is `{ currency0, currency1, fee, tickSpacing, hooks }` | `sqrtPriceLimitX96` | negative (`-amount`) |

**Swap exact input only.** The Router caps what a callback may take at the exact-input amount; an
exact-output swap (the other sign) has no such cap. A `sqrtPriceLimitX96` of `0` means no limit,
which leaves `minOut` as the only bound: set a real limit. PancakeSwap Infinity, Maverick V2 and the
unified `swap` are under "Other entry points" below.

## Which pools `swapV3` drives

`swapV3` checks that the pool's `token0`/`token1` are the requested pair (`InvalidPool` otherwise),
calls the pool's Uniswap-V3 `swap`, and services the pool's callback under any of these names:

- `uniswapV3SwapCallback`: Uniswap V3 and forks that keep the name, including Aerodrome Slipstream;
- `pancakeV3SwapCallback`: PancakeSwap V3;
- `algebraSwapCallback`: Algebra pools (Camelot V3, QuickSwap V3), whose `swap` has the same
  selector as Uniswap V3's;
- `synthraV3SwapCallback`, `unitFlowV3SwapCallback`: Synthra V3 and UnitFlow V3.

`unlockCallback` serves Uniswap V4 and `lockAcquired` PancakeSwap Infinity.

Each callback is authenticated to the pool being swapped, pays **once**, and pays only the input
the pool asks for, in the input token, never more than the exact input
(`InputExceedsAuthorized`). A pool asking to be paid in the output token is refused.

## Price limits and partial fills

`sqrtPriceLimitX96` is `floor(sqrt(token1Units / token0Units) * 2^96)`, with token0 the lower of
the two addresses. Selling token0 moves the price down, so the limit is a floor; selling token1
moves it up, so it is a ceiling. It must lie strictly between `4295128739` and
`1461446703485210103287273052203988822378723970342` and on the far side of the pool's current
price, or the pool reverts.

**It bounds the pool's price after the swap, not the price paid.** One number is the same pool price
on every V3-style pool of the pair and on V4 pools of the same two currencies, but the fee comes on
top, and it differs per pool: under one limit, the last unit a 1% pool fills costs about 1% more
than the limit, a 0.05% pool's about 0.05%. To bound the price paid, give each pool its own limit:
`limit ÷ √(1 − fee)` selling token0, `limit × √(1 − fee)` selling token1 (`sauce-distributed-swap`
computes it and reads each pool's fee).

A pool offered more than it can fill before its price reaches the limit **takes only what it
can**: the callback pays exactly the pool's delta, and the rest of the input stays in the Pot. That
is what a limit is for (the remainder can go to another venue or back to the user), and why a leg
must never end with input left in the Pot.

A V4 pool priced in native ETH has `currency0` = `0x0`: it is a different pair from the WETH pools,
and it needs native ETH in the Pot.

## The guard (required on every swap)

The Router returns the deltas but checks no minimum output and refunds nothing. Wrap every swap:

1. Record the output token's Pot balance before the swap, and measure the output as the **delta**.
2. `require(out >= minOut, ...)`, `minOut` being a `main` input: a short fill reverts the whole
   transaction.
3. Pay the output out with a SafeERC20 `transfer`.
4. Send whatever input is still in the Pot back to the user or a refund address.

**Every leg either takes all its input or returns the rest.** A venue that can stop part way, at a
price or tick limit, is swapped only through the Router: its callback pays exactly what the pool
took, and the unspent input stays in the Pot for the guard to return.

[examples/swap-leg.sauce.ts](examples/swap-leg.sauce.ts) is exactly this for one Uniswap V3 pool.
Rehearse it (`--assume-balance` gives the Pot the input for the rehearsal only), then run it with
the input in the Pot or pulled in with `--fund`:

```sh
npx sauce simulate swap-leg.sauce.ts --chain base --owner <address> --config sauce.config.json \
  --assume-balance WETH:0.5 \
  --args <tokenIn> <tokenOut> 500 <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
npx sauce run swap-leg.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --fund WETH:0.5 --args <tokenIn> <tokenOut> 500 <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
```

The cook is one transaction to the Pot (`cook(engine, program)` with `main`'s arguments appended,
paying the Kitchen's fee): `sauce tx` prints it unsigned, `{ chainId, to, data, value }`, for any
signer to send instead of `sauce run`.

For several venues under one price limit, use `sauce-distributed-swap`.

## Other entry points

| Entry point                                                                                              | Venues                   | Price bound                            | Exact input is           |
| -------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------- | ------------------------ |
| `swapInfinityCL(vault, key, zeroForOne, amountSpecified, sqrtPriceLimitX96, payer, recipient, callback)` | PancakeSwap Infinity CL  | `sqrtPriceLimitX96`                    | negative (required)      |
| `swapInfinityBin(vault, key, swapForY, amountSpecified, payer, recipient, callback)`                     | PancakeSwap Infinity Bin | none                                   | negative (required)      |
| `swapMaverickV2Bounded(params, tickLimit)`                                                               | Maverick V2              | `tickLimit`                            | positive                 |
| `swap(params)`, `params.poolType` below                                                                  | the unified entry point  | `params.sqrtPriceLimitX96` (V3 and V4) | positive, UniV4 negative |

Maverick V2 can stop part way, so it goes through `swapMaverickV2Bounded`, never a payment
straight to the pool, which would leave the unfilled part with the pool.

Unified `swap` pool types (`poolType` values): `UniV2` 0, `UniV3` 1, `UniV4` 2, `Curve` 3,
`BalancerV2` 4, `DODOV2` 5, `TraderJoeLB` 6, `MaverickV2` 7, `WOOFi` 8. Its `poolKey` is used by
UniV4 (all five fields) and UniV2 (`fee`, the LP fee in ppm; `0` means 3000). Only V3 and V4 honour a
price limit; the others fill in full or revert, bounded only by the guard.

## Example

[examples/swaps.mts](examples/swaps.mts) compiles the leg and pins the entry points, their price
parameters, the callbacks and the pool-type table above against the Router ABI the package serves.
