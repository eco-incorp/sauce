---
name: sauce-swaps
description: Swapping inside a Sauce program with @sauce/router — one function per venue (uniswapV2, uniswapV3, uniswapV4, curve, balancerV2, dodoV2, traderJoeLB, woofi, maverickV2, and the try forms), every argument a run-time value, each returning what the recipient received and reverting below minOut; which venues are paid first and which call back through the Pot's Router, which pool families the Router's callbacks service (Uniswap V3 and forks, PancakeSwap V3, Algebra, Synthra, UnitFlow, Uniswap V4), exact input only, how a price limit produces a partial fill, the PancakeSwap Infinity entry points on the Router itself, and the guard that stops a leg from stranding input. Use when the user wants a swap, trade, price limit, sqrtPriceLimitX96, min-out or slippage bound, a partial fill, "swap then …", or asks which venues Sauce can swap on.
---

# Swaps with `@sauce/router`

`@sauce/router` is the package's swap library: one SauceScript function per venue. A program
imports the ones it uses, and the package serves the library to every compile, so the import is all
it needs:

```sauce chain=base,arbitrum
import { uniswapV3 } from "@sauce/router";

function main(amount: Uint256, sqrtPriceLimitX96: Uint256, minOut: Uint256) {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500n);
  uniswapV3(pool, WETH, USDC, amount, sqrtPriceLimitX96, minOut, ctx.self());
}
```

Every argument is a run-time value, so a program can choose the pool, the direction and the amount
while it runs: spend what an earlier swap returned, read a balance, loop over a list of pools.

A tokenized stock (`SPCXc` on Base, `TSLAon` on Ethereum, `TSLAx` on Solana) is swapped like any token; its symbol
and what differs about it are in `sauce-globals`
([Tokenized stocks](../sauce-globals/SKILL.md#tokenized-stocks)).

## Functions

Every function takes its arguments in one order — the pool, the two tokens, the amount, the venue's
own facts, then the floor and the recipient — and returns the amount of `tokenOut` the recipient
received:

| Function      | Arguments                                                                                                 | Reached through  |
| ------------- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| `uniswapV2`   | `pair, tokenIn, tokenOut, amountIn, feePpm, minOut, recipient`                                            | the pair         |
| `uniswapV3`   | `pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient`                                 | the Pot's Router |
| `uniswapV4`   | `poolManager, tokenIn, tokenOut, amountIn, fee, tickSpacing, hooks, sqrtPriceLimitX96, minOut, recipient` | the Pot's Router |
| `curve`       | `pool, tokenIn, tokenOut, amountIn, i, j, uint256Indices, minOut, recipient`                              | the pool         |
| `balancerV2`  | `vault, tokenIn, tokenOut, amountIn, poolId, minOut, recipient`                                           | the Vault        |
| `dodoV2`      | `pool, tokenIn, tokenOut, amountIn, baseToken, quoteToken, minOut, recipient`                             | the pool         |
| `traderJoeLB` | `pair, tokenIn, tokenOut, amountIn, tokenX, tokenY, minOut, recipient`                                    | the pair         |
| `woofi`       | `pool, tokenIn, tokenOut, amountIn, minOut, recipient`                                                    | the WooPPV2      |
| `maverickV2`  | `pool, tokenIn, tokenOut, amountIn, minOut, recipient`                                                    | the Pot's Router |

- **`amountIn`** is what the Pot pays. **Every swap is exact input.**
- **`minOut`** is the least the swap may deliver; below it the whole program reverts. `0n` sets no
  floor, except for `woofi`, which requires a positive one.
- **`recipient`** receives the output; `ctx.self()` keeps it in the Pot.
- `feePpm` is a V2 pair's LP fee in parts per million (3000, which `0n` also means, for Uniswap V2;
  2500 for PancakeSwap V2). `uniswapV4` takes the pool key's `fee`, `tickSpacing` and `hooks`, and
  builds the key from `tokenIn` and `tokenOut` in sort order. `uint256Indices` picks a Curve
  CryptoSwap pool's `uint256` coin indices over a StableSwap pool's `int128` ones.

`tryUniswapV2`, `tryCurve`, `tryBalancerV2` and `tryTraderJoeLB` take the same arguments as the
function they name and return `0n`, having moved nothing, instead of reverting when the swap cannot
be made. DODO V2 and WOOFi have no `try` form.

## How each venue is reached

**Paid first.** Uniswap V2 and its forks, Curve, Balancer V2, DODO V2, Trader Joe LB and WOOFi never
call back: the function pushes the input to the pool, or approves exactly the input for the pool to
pull, and calls it. Such a swap **consumes its whole input or reverts**; nothing is refunded.

**Called back.** Uniswap V3 and its forks, Uniswap V4 and Maverick V2 pools re-enter their caller
mid-swap to be paid, which a program cannot answer. Those functions call the **Pot's Router**,
`ctx.self()`: the Pot's fallback delegatecalls the Router it is configured with (`router()` on the
Pot), so the Router runs in the Pot's context, holds the Pot's balances, and answers the callback.
It services these callbacks:

- `uniswapV3SwapCallback`: Uniswap V3 and forks that keep the name, including Aerodrome Slipstream;
- `pancakeV3SwapCallback`: PancakeSwap V3;
- `algebraSwapCallback`: Algebra pools (Camelot V3, QuickSwap V3), whose `swap` has the same
  selector as Uniswap V3's;
- `synthraV3SwapCallback`, `unitFlowV3SwapCallback`: Synthra V3 and UnitFlow V3;
- `unlockCallback`: Uniswap V4.

So `uniswapV3` drives every one of those V3-style pools. Each callback is authenticated to the pool
being swapped (`InvalidPool` for a pool that is not the requested pair), pays **once**, and pays only
the input the pool asks for, never more than `amountIn` (`InputExceedsAuthorized`).

Every token write is `@sauce/token`'s SafeERC20: a token that returns nothing (USDT) works, one that
returns `false` reverts the program.

**Direction is checked from the arguments.** A V2 pair's and a V4 pool's direction is the sort order
of `tokenIn` and `tokenOut`; `dodoV2` takes the pool's base and quote tokens and `traderJoeLB` its X
and Y tokens, and each reverts unless `tokenIn` and `tokenOut` are those two; the Router checks a V3
pool's tokens itself. Take these facts from the pool, as you take the pool itself.

## Price limits and partial fills

`sqrtPriceLimitX96` is `floor(sqrt(token1Units / token0Units) * 2^96)`, with token0 the lower of
the two addresses, so one number means the same price on every V3-style pool of the pair and on V4
pools of the same two currencies. Selling token0 moves the price down, so the limit is a floor;
selling token1 moves it up, so it is a ceiling. It must lie strictly between `4295128739` and
`1461446703485210103287273052203988822378723970342` and on the far side of the pool's current
price, or the pool reverts `SPL`. A limit of `0n` means none, which leaves `minOut` as the only
bound: set a real limit.

**Convert a price with `sauce price`**, which reads no network:
`npx sauce price --chain base WETH USDC 2686.5`. The price is **quote per base**: the first token
is the one priced, the second what it is priced in, so this is 2,686.5 USDC per WETH. Swapped,
`USDC WETH 2686.5` would mean 2,686.5 WETH per USDC, a limit nowhere near any pool. It prints the
pair's order on the chain (on Base WETH is token0, the lower address, and USDC token1) and two
blocks:

- **`sell`** (the base token in: WETH → USDC): its `sqrtPriceLimitX96` is a **floor**;
- **`buy`** (the base token out: USDC → WETH): its `sqrtPriceLimitX96` is a **ceiling**.

Each block also gives `minAvgPrice` for that direction. Take the limit from the block of the
direction you trade.

**Put the limit near the current price, on the far side of it.** A limit far beyond the price, such
as the bound itself, is no limit at all: the pool fills down (or up) to it at any price. One on the
wrong side fills nothing: a single swap reverts `SPL`, and a distributed swap skips every pool and
refunds everything, which is not a success. In a real run never pass `minOut` as `0`.

**Build the limit from the best price a taker gets among pools with liquidity**: drop the pools
with no in-range liquidity (`liquidity()`, or less than the order needs), take the best price after
each pool's fee, and move it by the slippage you accept. Never a pool's price alone: a pool with no
liquidity at its price keeps a stale price that can be far from the market. Nor the deepest pool's
mid price: a pool's mid sits up to its fee away from the cheap pools, so a 0.3% pool's price is a
loose reference. `sauce-distributed-swap` works this through on Base.

**It bounds the pool's price after the swap, not the price paid.** One number is the same pool price
on every V3-style pool of the pair, but the fee comes on top, and it differs per pool: under one
limit, the last unit a 1% pool fills costs about 1% more than the limit, a 0.05% pool's about
0.05%. To bound the price paid, give each pool its own limit: `limit ÷ √(1 − fee)` selling token0,
`limit × √(1 − fee)` selling token1 (`sauce-distributed-swap` computes it for each pool).

A pool offered more than it can fill before its price reaches the limit **takes only what it
can**: the Router pays exactly the pool's delta, and the rest of the input stays in the Pot. That
is what a limit is for (the remainder can go to another venue or back to the user), and why a leg
must never end with any of its input left in the Pot.

A V4 pool priced in native ETH has `currency0` = `0x0`: it is a different pair from the WETH pools,
and it needs native ETH in the Pot.

## When a swap reverts

A V3-style pool reverts with a short string, and the Router with a custom error:

| Revert                                   | From       | Means                                                                                           |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `SPL`                                    | the pool   | the price limit is on the wrong side of the pool's current price, or at or past a bound (above) |
| `AS`                                     | the pool   | the amount is zero                                                                              |
| `LOK`                                    | the pool   | the pool is not initialized (or is mid-swap)                                                    |
| `IIA`                                    | the pool   | its callback paid less input than it asked for                                                  |
| `TF`                                     | the pool   | its transfer of the output token failed                                                         |
| `InvalidPool()`, `0x2083cd40`            | the Router | the pool's `token0`/`token1` are not the pair passed                                            |
| `InputExceedsAuthorized()`, `0x510db218` | the Router | the pool asked for more input than the exact input offered                                      |

A revert inside the program (a `require`, the library's `minOut` check) is the program's own; the
cook reverts as a whole either way.

## PancakeSwap Infinity

PancakeSwap Infinity pools are not in the library: the Router's own entry points swap them, called
through the Pot with the Router ABI the package serves (`import { ISauceRouter } from
"./artifacts/ISauceRouter.json"`, then `ISauceRouter.at(ctx.self())`). Their exact input is a
negative amount (`-amount`), and they return the pool's signed deltas, not a received amount: the
program measures the output and checks its own floor.

| Entry point                                                                                              | Price bound         |
| -------------------------------------------------------------------------------------------------------- | ------------------- |
| `swapInfinityCL(vault, key, zeroForOne, amountSpecified, sqrtPriceLimitX96, payer, recipient, callback)` | `sqrtPriceLimitX96` |
| `swapInfinityBin(vault, key, swapForY, amountSpecified, payer, recipient, callback)`                     | none                |

## The guard (required on every leg)

The library checks `minOut`; what is left is the input a price limit left unspent:

1. Pass a `minOut` that is a `main` input, so a short fill reverts the whole transaction.
2. Pay the output to its recipient (`recipient` does it), or keep it in the Pot for the next step.
3. Send the rest of the input back to the user or a refund address: `amountIn` less what the
   swap took (the input balance before minus after), not the Pot's whole balance of the token,
   which on an owner's Pot may hold more of it for other uses. A full sweep is only for an intent
   body on the shared intent Pot, which holds nothing of anyone's (`sauce-intents`).

[examples/swap-leg.sauce.ts](examples/swap-leg.sauce.ts) is exactly this for one Uniswap V3 pool.
Rehearse it, then run it, with the input in the Pot (or pulled in with `--fund`):

```sh
npx sauce simulate swap-leg.sauce.ts --chain base --owner <address> \
  --args <tokenIn> <tokenOut> 500 <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
npx sauce run swap-leg.sauce.ts --chain base --keystore <keystore> \
  --fund WETH:0.5 --args <tokenIn> <tokenOut> 500 <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
```

A swap is sent on a chain the initial release supports, Ethereum or Base here; on a preview chain
the leg compiles and simulates, and `sauce tx` and `sauce run` refuse it with the chain-support
request for that chain (`sauce-chains`).

For several venues under one price limit, use `sauce-distributed-swap`.

## Example

[examples/swaps.mts](examples/swaps.mts) compiles the leg and pins the library's functions, the
Router's entry points, their price parameters and the callbacks above against what the package
serves.
