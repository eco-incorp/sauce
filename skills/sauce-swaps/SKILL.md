---
name: sauce-swaps
description: Swapping inside a Sauce program with @sauce/router, the swap library, on EVM chains and Solana. One function per EVM venue (uniswapV2, uniswapV3, uniswapV4, curve, balancerV2, dodoV2, traderJoeLB, woofi, maverickV2, infinityCL, infinityBin) and a try form of each, every argument a run-time value, each returning what the recipient received and reverting below minOut; which venues are paid first and which call back through the Pot's Router, and the pool families its callbacks service; exact input only; sqrtPriceLimitX96 and sauce price; partial fills; the reverts; the guard every leg needs. On Solana, a namespace per price-limited venue (Orca.Whirlpool.swap(pool, …), its pool found by key with Orca.Whirlpool.pool(USDC, WSOL, 4), its accounts derived), one swap returning 0 where the pool cannot trade, and every exact-input venue's forms. Use when the user wants a swap, trade, price limit, sqrtPriceLimitX96, min-out or slippage bound, a partial fill, "swap then …", or asks which venues Sauce can swap on.
---

# Swaps with `@sauce/router`

`@sauce/router` is the package's swap library: one SauceScript function per venue, served to every
compile, so an import is all a program needs. This skill owns that library on both targets: its
functions and their arguments, how each venue is paid, price limits and partial fills, the reverts,
and the guard every leg needs. Several pools under one price is `sauce-distributed-swap` (on
Solana, `sauce-solana-distributed-swap`).

## When to use

| Task                                                          | Here                        | Elsewhere                                                 |
| ------------------------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| One swap, or a swap as one step of a program                  | yes                         |                                                           |
| A price limit, `minOut`, a partial fill; a swap that reverted | yes                         |                                                           |
| A swap at one Solana pool                                     | yes                         | the accounts it moves through: `sauce-solana`             |
| One order over several pools under one price                  |                             | `sauce-distributed-swap`, `sauce-solana-distributed-swap` |
| A swap as a step of a JSON document                           |                             | `sauce-actions`                                           |
| Which pools a pair has                                        | `sauce pools` (`sauce-cli`) |                                                           |

## Core model

- **Import what you use**: `import { uniswapV3 } from "@sauce/router";`. Every argument is a
  run-time value, so a program chooses the pool, direction and amount while it runs.
- **Every swap is exact input.** `amountIn` is what the Pot pays; `minOut` is the least the swap
  may deliver, below which the whole program reverts; `recipient` receives the output, and
  `ctx.self()` keeps it in the Pot for a later step. Each function returns what the recipient
  received.
- **Paid first, or called back.** Some venues are paid before they are called; the rest call their
  caller back mid-swap, which the **Pot's Router** answers.
- **A price limit stops a pool part way**: the pool takes only what it fills before the limit, and
  the rest of the input stays in the Pot. Every leg returns that rest (the guard).
- Every token write is `@sauce/token`'s SafeERC20: USDT works; a `false` return reverts.
- A tokenized stock (`SPCXc`, `TSLAon`, `TSLAx`) swaps like any token (`sauce-globals`).

```sauce chain=base,arbitrum
import { uniswapV3 } from "@sauce/router";

// Sells `amount` of the Pot's WETH for USDC, paid to `recipient`: the user's wallet, or
// `ctx.self()` to keep the USDC in the Pot.
function main(amount: Uint256, sqrtPriceLimitX96: Uint256, minOut: Uint256, recipient: Address) {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  uniswapV3(pool, WETH, USDC, amount, sqrtPriceLimitX96, minOut, recipient);
}
```

## Functions

One argument order for all: the pool, the two tokens, the amount, the venue's own facts, then the
floor and the recipient.

| Function      | Arguments                                                                                                       | Reached through  |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| `uniswapV2`   | `pair, tokenIn, tokenOut, amountIn, feePpm, minOut, recipient`                                                  | the pair         |
| `uniswapV3`   | `pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient`                                       | the Pot's Router |
| `uniswapV4`   | `poolManager, tokenIn, tokenOut, amountIn, fee, tickSpacing, hooks, sqrtPriceLimitX96, minOut, recipient`       | the Pot's Router |
| `curve`       | `pool, tokenIn, tokenOut, amountIn, i, j, uint256Indices, minOut, recipient`                                    | the pool         |
| `balancerV2`  | `vault, tokenIn, tokenOut, amountIn, poolId, minOut, recipient`                                                 | the Vault        |
| `dodoV2`      | `pool, tokenIn, tokenOut, amountIn, baseToken, quoteToken, minOut, recipient`                                   | the pool         |
| `traderJoeLB` | `pair, tokenIn, tokenOut, amountIn, tokenX, tokenY, minOut, recipient`                                          | the pair         |
| `woofi`       | `pool, tokenIn, tokenOut, amountIn, minOut, recipient`                                                          | the WooPPV2      |
| `maverickV2`  | `pool, tokenIn, tokenOut, amountIn, minOut, recipient`                                                          | the Pot's Router |
| `infinityCL`  | `vault, tokenIn, tokenOut, amountIn, poolManager, fee, parameters, hooks, sqrtPriceLimitX96, minOut, recipient` | the Pot's Router |
| `infinityBin` | `vault, tokenIn, tokenOut, amountIn, poolManager, fee, parameters, hooks, minOut, recipient`                    | the Pot's Router |

- `minOut` `0` sets no floor, except for `woofi`, which requires a positive one.
- `feePpm` is a V2 pair's LP fee in parts per million (3000, which `0` also means, for Uniswap V2;
  2500 for PancakeSwap V2).
- `uniswapV4` takes the pool key's `fee`, `tickSpacing` and `hooks` and builds the key from
  `tokenIn` and `tokenOut` in sort order. A V4 pool priced in native ETH has `currency0` = `0x0`: a
  different pair from the WETH pools, needing native ETH in the Pot.
- `uint256Indices` picks a Curve CryptoSwap pool's `uint256` coin indices over a StableSwap pool's
  `int128` ones.
- `infinityCL` and `infinityBin` swap PancakeSwap Infinity CL and bin pools the way `uniswapV4`
  swaps a V4 pool: the key built from the tokens in sort order with the pool's `poolManager`, `fee`,
  `parameters` and `hooks`; `vault` is the Infinity Vault.

**Each function has a `try` form** (`tryUniswapV2`, `tryCurve`, `tryBalancerV2`, `tryDodoV2`,
`tryTraderJoeLB`, `tryWoofi`, `tryUniswapV3`, `tryUniswapV4`, `tryMaverickV2`, `tryInfinityCL`,
`tryInfinityBin`) with the same arguments, returning `0`, having moved nothing, where the plain
form would revert. A swap that ran returns at least 1, so `0` always means nothing moved.

| `try` forms of            | Skip without moving anything                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| venues paid first         | a failing check of the pool's own view first (the V2 reserves, LB's `getSwapOut`, DODO V2's `querySellBase`/`querySellQuote`, WooPPV2's `query`), or the pool's failure caught and the approval reset (`tryCurve`, `tryBalancerV2`); a pool with no code |
| venues through the Router | the Router's call caught: a pool with no code, a pool for another pair, a key no pool has, a swap the pool or Router refuses; a swap that ran in a pool with no liquidity in range returns `0`                                                           |

A Router-form swap that ran must still deliver `minOut`, and at least 1, or the whole program
reverts: an input the pool kept (dust it takes as its fee) cannot be given back. With no price
limit, an empty pool costs a full tick walk before it is skipped, millions of gas: pass a
`sqrtPriceLimitX96` to bound it.

## How each venue is reached

**Paid first.** Uniswap V2 and its forks, Curve, Balancer V2, DODO V2, Trader Joe LB and WOOFi
never call back: the function pushes the input to the pool, or approves exactly the input for the
pool to pull, and calls it. Such a swap **consumes its whole input or reverts**; nothing is
refunded.

**Called back.** Uniswap V3 and its forks, Uniswap V4, Maverick V2 and PancakeSwap Infinity pools
re-enter their caller mid-swap to be paid, which a program cannot answer. Those functions call the
**Pot's Router**, `ctx.self()`: the Pot's fallback delegatecalls the Router it is configured with
(`router()` on the Pot), so the Router runs as the Pot, holds the Pot's balances and answers:

| Callback                                          | Pools                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `uniswapV3SwapCallback`                           | Uniswap V3 and forks that keep the name, Aerodrome Slipstream included           |
| `pancakeV3SwapCallback`                           | PancakeSwap V3                                                                   |
| `algebraSwapCallback`                             | Algebra pools (Camelot V3, QuickSwap V3), whose `swap` has Uniswap V3's selector |
| `synthraV3SwapCallback`, `unitFlowV3SwapCallback` | Synthra V3, UnitFlow V3                                                          |
| `unlockCallback`                                  | Uniswap V4                                                                       |
| `maverickV2SwapCallback`                          | Maverick V2                                                                      |
| `lockAcquired`                                    | PancakeSwap Infinity, CL and bin pools alike                                     |

So `uniswapV3` drives every V3-style pool above. Each callback is authenticated to the pool being
swapped, pays **once**, and pays only the input the pool asks for, never more than `amountIn`
(`InputExceedsAuthorized`).

**Direction is checked from the arguments.** A V2 pair's and a V4 pool's direction is the sort
order of `tokenIn` and `tokenOut`; `dodoV2` takes the pool's base and quote tokens and
`traderJoeLB` its X and Y tokens, and each reverts unless `tokenIn` and `tokenOut` are those two;
the library checks a V3 pool's tokens. Take these facts from the pool, as you take the pool.

**The Router's own entry points**, which a program can also call with the Router ABI the package
serves (`import { ISauceRouter } from "./artifacts/ISauceRouter.json"`, then
`ISauceRouter.at(ctx.self())`), take a positive unsigned exact input and return
`(amountInUsed, amountOut)`. PancakeSwap Infinity's:

| Entry point                                                                               | Price bound         |
| ----------------------------------------------------------------------------------------- | ------------------- |
| `swapInfinityCL(vault, key, tokenIn, zeroForOne, amountIn, sqrtPriceLimitX96, recipient)` | `sqrtPriceLimitX96` |
| `swapInfinityBin(vault, key, tokenIn, swapForY, amountIn, recipient)`                     | none                |

## A protocol's router, as its own examples call it

A protocol's router works in a program too, called as the protocol's Solidity examples call it:
approve it for the input (`USDC.approve(router, amount)`, or `approve(token, router, amount)` for a
token the registry names only as a contract), then call it through its namespace. Its exact-output
forms are the one thing the library has no function for: Uniswap V3's SwapRouter buys an exact
amount for at most a maximum. [examples/uniswap-v3-swap-examples.sauce.ts](examples/uniswap-v3-swap-examples.sauce.ts)
ports the four swaps of Uniswap's own `SwapExamples` contract to `UniswapV3.SwapRouter`: exact
input and exact output, in one pool and along a path through two, each the function it was in
Solidity, with the minimum (or maximum) a `main` input where the original passed none.
[examples/uniswap-v4-swap.sauce.ts](examples/uniswap-v4-swap.sauce.ts) ports Uniswap's V4 swap
guide: the Universal Router approved through `Permit2.Permit2` for exactly the input, then one
`V4_SWAP` command whose actions swap in one pool, settle the input and take the output, its inputs
built with `abi.encode` and checked against what arrived. To swap on V4 inside a program, the
library's `uniswapV4` is shorter; this is how a program speaks to a router that takes commands.
[examples/balancer-v2-batch-swap.sauce.ts](examples/balancer-v2-batch-swap.sauce.ts) ports
Balancer's batch swap examples: token A to token C through B across two pools in one `batchSwap`,
given in or given out, with the Vault's limits (positive in, negative out) from a `main` input.

## Flash swaps

A flash loan's lender pays first and then calls the borrower back to be repaid
(`uniswapV3FlashCallback`, Aave's `executeOperation`); a Pot cannot be called back by a program,
since its fallback runs its Router. The Router's own `flash(callback, swap)` is the flash a program
has: it runs one swap whose pool sends the output first (the calldata of `swapV3`, `swapV4`,
`swapMaverickV2`, `swapInfinityCL` or `swapInfinityBin`), runs `callback` as a program inside the
pool's callback, and pays the pool after it, out of what the Pot then holds. A callback that leaves
the Pot short fails the payment, and the whole transaction reverts. `program(() => { … })` compiles
the callback from a closure that reads the program's own values, and its `code` with its `args`
appended is the callback's bytes; the program declares `flash` in an ABI beside it, since
`@sauce/router` has no function for it, and calls it on `ctx.self()`.
[examples/uniswap-v3-pair-flash.sauce.ts](examples/uniswap-v3-pair-flash.sauce.ts) ports Uniswap's
`PairFlash` this way, with [examples/SauceRouterFlash.json](examples/SauceRouterFlash.json): the
output of a swap in one pool, sold back in another before the first is paid, the profit to a payer.

Balancer's flash swap needs none of that: one `batchSwap` that sells a token to one pool and buys it
back from another is settled by the Vault as a whole, so the Pot sends nothing (its limits are zero)
and receives the profit, and a cycle that would cost anything reverts on the limits.
[examples/balancer-v2-flash-swap.sauce.ts](examples/balancer-v2-flash-swap.sauce.ts) ports Balancer's
own example of it.

## Price limits and partial fills

`sqrtPriceLimitX96` is `floor(sqrt(token1Units / token0Units) * 2^96)`, token0 the lower of the two
addresses, so one number means the same price on every V3-style pool of the pair and on the V4 pools
of the same two currencies.

- **Selling token0 moves the price down**, so its limit is a floor; **selling token1 moves it up**,
  so its limit is a ceiling.
- It must lie strictly between `4295128739` and
  `1461446703485210103287273052203988822378723970342`, and on the far side of the pool's current
  price, or the pool reverts `SPL`.
- **A limit of `0` means none**, which leaves `minOut` as the only bound: set a real limit.
- **Put it near the current price, on the far side.** A limit far beyond the price, such as the
  bound itself, fills at any price; one on the wrong side fills nothing (a single swap reverts
  `SPL`; a distributed swap skips every pool and refunds everything, which is not a success).
- **It bounds the pool's price after the swap, not the price paid.** The fee comes on top: under one
  limit, the last unit a 1% pool fills costs about 1% more than the limit. To bound the price paid,
  give each pool its own limit, `limit ÷ √(1 − fee)` selling token0, `limit × √(1 − fee)` selling
  token1 (`sauce-distributed-swap` computes it per pool).
- **A pool offered more than it fills before its limit takes only what it can**: the Router pays
  exactly the pool's delta, and the rest of the input stays in the Pot. That is what a limit is for,
  and why a leg must never end with its input left in the Pot.

**Turn a price into a limit with `sauce price`**, which reads no network:
`sauce price --chain base WETH USDC 2686.5`. The price is **quote per base**: the first token is the
one priced, the second what it is priced in, so this is 2,686.5 USDC per WETH (swapped, it would
mean 2,686.5 WETH per USDC, nowhere near any pool). It prints the pair's order on the chain (on
Base WETH is token0, USDC token1) and two blocks:

- **`sell`** (the base token in: WETH → USDC): its `sqrtPriceLimitX96` is a **floor**;
- **`buy`** (the base token out: USDC → WETH): its `sqrtPriceLimitX96` is a **ceiling**.

Each also gives that direction's average floor `minAvgPrice` (output per input:
`out * 1e18 >= minAvgPrice * spent`) and the other way round `priceLimit` and `maxAvgPrice` (input
per output), which the distributed swap takes. Take the limit from the block of the direction you trade.
`--pool <address>` reads a pool's price now.

**Build the limit from the best price a taker gets among pools with liquidity**: drop the pools with
no in-range liquidity (`liquidity()`, or less than the order needs), take the best price after each
pool's fee, and move it by the slippage you accept. Never a pool's price alone (an empty pool keeps
a stale price), nor the deepest pool's mid price (it sits up to its fee away from the cheap pools).
`sauce pools --chain <chain> <tokenA> <tokenB>` lists each pool's price with and without its fee.

## The guard

Required on every leg. The library checks `minOut`; what is left is the input a price limit left
unspent:

1. Pass a `minOut` that is a `main` input, so a short fill reverts the whole transaction. In a real
   run never pass `0`.
2. Pay the output to its recipient (`recipient` does it), or keep it in the Pot for the next step.
3. Send the rest of the input back to the user or a refund address: `amountIn` less what the swap
   took (the input balance before minus after), never the Pot's whole balance of the token, which
   may hold more of it for other uses.

[examples/swap-leg.sauce.ts](examples/swap-leg.sauce.ts) is exactly this for one Uniswap V3 pool.
Simulate it, then run it, with the input in the Pot or pulled in with `--fund`:

```sh
sauce simulate swap-leg.sauce.ts --chain base --owner <address> \
  --args <tokenIn> <tokenOut> 500 <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
sauce run swap-leg.sauce.ts --chain base --keystore <keystore> \
  --fund WETH:0.5 --args <tokenIn> <tokenOut> 500 <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
```

## When a swap reverts

| Revert                                   | From       | Means                                                                                   |
| ---------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `SPL`                                    | the pool   | the price limit is on the wrong side of the pool's current price, or at or past a bound |
| `AS`                                     | the pool   | the amount is zero                                                                      |
| `LOK`                                    | the pool   | the pool is not initialized (or is mid-swap)                                            |
| `IIA`                                    | the pool   | its callback paid less input than it asked for                                          |
| `TF`                                     | the pool   | its transfer of the output token failed                                                 |
| `InputTokenMismatch()`                   | the Router | the input token does not match the pool key and direction                               |
| `InputExceedsAuthorized()`, `0x510db218` | the Router | the pool asked for more input than the exact input offered                              |

A revert inside the program (a `require`, the library's `minOut` check) is the program's own; the
cook reverts as a whole either way.

## On Solana

### A venue by its namespace

A program calls a venue by its namespace, as a program on an EVM chain calls a protocol, finds the
pool by its key, as an EVM program asks a factory for a pool, and is given no accounts:

```sauce chain=solana
function main(to: Address, amountIn: Uint256, priceLimit: Uint256, minOut: Uint256): Uint256 {
  const got = Orca.Whirlpool.swap(
    Orca.Whirlpool.pool(USDC, WSOL, 4),
    USDC,
    WSOL,
    amountIn,
    priceLimit,
    minOut,
  );
  if (got > 0) WSOL.transfer(to, got);
  return got;
}
```

```sh
sauce run solana-swap.sauce.ts --chain solana --keypair <keypair> \
  --args <recipient> 100000000 200000000000000000 400000000
```

- **The namespaces** are each venue's protocol then its program: `Raydium.CLMM`,
  `Pancakeswap.CLMM`, `Byreal.CLMM`, `Stabble.CLMM`, `Orca.Whirlpool`, `Cropper.Whirlpool`,
  `Defituna.Fusion`, `Crema.CLMM` and `Phoenix.Market`, each with one
  `swap(pool, tokenIn, tokenOut, amountIn, priceLimit, minOut)`. It returns what arrived; where the
  pool cannot trade (below) it returns `0` having moved nothing, and below `minOut` the cook
  reverts. `sauce globals --chain solana` lists them.
- **`pool(tokenA, tokenB, key)` finds the pool by its key**: the pool the venue's program keeps for
  the pair at a tick spacing (`Orca.Whirlpool`, `Cropper.Whirlpool`, `Defituna.Fusion`,
  `Crema.CLMM`) or a fee in millionths (`Raydium.CLMM`, `Pancakeswap.CLMM`, `Byreal.CLMM`,
  `Stabble.CLMM`: 400 is 0.04%), either token first. It is written as the swap's pool, its key a
  number written out or a loop's variable over numbers written out
  (`for (const spacing of [4, 1]) { … }`, one pool per key). Where the venue keeps two configs at
  one fee (Raydium's and PancakeSwap's 0.01% and 0.05%), the tick spacing follows the fee
  (`Raydium.CLMM.pool(USDC, WSOL, 100, 1)`), and the fee alone is refused for a pair with a pool
  under both. A whirlpool venue's spacing alone names the pool on its static fee tier; a pool on
  an adaptive-fee tier (Orca's 1025, at spacing 64) is named by the tier's index after the spacing
  (`Orca.Whirlpool.pool(SPCX_US, USDC, 64, 1025)`), and `swap` skips it, as it skips a
  Raydium-code pool with a dynamic fee: a fee of more than one rate takes no part at a price. Where
  the venue has no pool at the key, the swap returns `0`.
  `sauce pools --chain solana USDC WSOL` prints how a program finds each pool (`byKey`).
  Phoenix's markets are named by their address instead: a `main` parameter declared `Address`.
- **`Meteora.DLMM`**'s `swap(pool, tokenIn, tokenOut, amountIn, minOut)` is Meteora DLMM's own swap,
  an exact input with no price limit: it pays all of `amountIn` or the cook fails, and reverts below
  `minOut`. Its pool is named by its address, its accounts derived the same way, its bin arrays the
  first two its bitmap marks in the trade's direction (the first alone for a pool with a Token-2022
  mint): an input past them fails the cook.
- **Each call compiles to that venue's function below** (`orcaWhirlpool`), keeping every check: the
  venue's program, the pool's owner, the pair, `minOut`. A pool of another venue reverts on chain
  (`not an Orca whirlpool`).
- **The pool and both tokens are known when the cook is built**: a pool by key, a `main` parameter
  declared `Address`, or a 32-byte key; a token by a registered symbol, a parameter or a key. The
  pool's nine accounts are read from the pool on the cluster for the token paid; the trader's are
  the Pot's (the authority, its account for `tokenIn`, the two mints, the token programs, the memo
  program). All are added to `main`, and `sauce compile --json` shows how each is derived
  (`slot:Orca.Whirlpool(USDC,WSOL,4):USDC.vaultA`, `self:USDC`). A pool no price-limit venue owns
  is refused before the cook.
- **What is bought lands in the Pot's own account for `tokenOut`** (Crema and Phoenix pay nowhere
  else); `sauce run` creates it when it is missing, asking first or with `--yes`. Forward what
  arrived with the token methods (`WSOL.transfer(to, got)`).
- **Choosing a pool**: `sauce pools --chain solana USDC WSOL` lists a pair's pools at each venue,
  deepest first, each with its key and its `priceLimit` (its price, fee included).

### The functions

One function per venue whose swap stops at a price limit and leaves the rest of the input:
`raydiumClmm`, `pancakeswapClmm`, `byreal`, `stabbleClmm`, `orcaWhirlpool`, `cropper`, `defituna`,
`crema` and `phoenix` (an immediate-or-cancel order on its book). Every one takes the same
arguments:

```text
orcaWhirlpool(slot, trader, amountIn, priceLimit, minOut, recipient): Uint256
```

| Argument     | What it is                                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `slot`       | the pool's nine accounts, `[program, pool, config, vaultA, vaultB, extra, ticks0, ticks1, ticks2]`, the System program for any the venue does not take; `sauce pools --chain solana` prints each pool's slot for the direction paid, and `sauce-solana-distributed-swap` says what each account is per venue |
| `trader`     | `[authority, source, payMint, buyMint, tokenProgram, token2022, memo]`: the authority that signs (the Pot), the token account paid from, the two mints, the two token programs, the memo program                                                                                                             |
| `priceLimit` | the most one unit bought may cost, fee included: payToken base units per buyToken base unit, times 1e18. The function reads the pool's fee and stops where its last unit, fee paid, costs `priceLimit`; the rest of `amountIn` stays in `source`                                                             |
| `recipient`  | the token account the output lands in; Crema and Phoenix pay only into the authority's own. The function returns what it gained                                                                                                                                                                              |

Each returns `0` having moved nothing for a missing slot (the System program as its pool), no
input, a pool whose swaps are off, a paused pool or a market not open, a fee that is more than one
rate, an empty pool, a pool already past its limit, an input too small to buy one unit at the pool's
price after its fee (dust), and a book with no offer within it. A swap that ran returns at least 1,
and below `minOut` the cook reverts. A failed call into another program fails the whole Solana
transaction and cannot be caught, so these are checks made before the swap. The accounts are the
caller's, so a pool that is not the pair, a slot whose program is not the venue's, and a pool of
another venue or of none revert; only the System program itself as the pool is a missing slot.

A concentrated-liquidity swap walks only the tick arrays its slot gives it, and past them its
program fails the whole transaction. So each of these holds its limit a tick inside them: Raydium's
code and Crema's to where the furthest array that way begins (or, for the array holding the price,
its last initialized tick that way), a whirlpool's to the far end of its three. A `priceLimit` past
the window buys up to it. A limit far past every price, with a large input, can still run a deep
pool out of the cook's compute before then: keep it tight.

Each of the eight concentrated-liquidity functions has a Stopped form, the same swap with its limit
held to a `stop` as well: its low 192 bits a tighter `priceLimit` (the swap takes the lower of the
two; `0` none), bits 192 to 223 a start bound, a tick past which the swap skips the pool (`1`
paying the lower-key token, `2^32 - 1` paying the other, skip it whatever its price), and on
Raydium's code and Crema bits 224 to 255 a deep tick (`0` none): the furthest array's last
initialized tick that way, which walks the swap on into that array, to a tick inside it. The
Stopped form reads the deep tick in its array and checks it there: one no longer initialized leaves
the swap where it would have stopped, and a place holding another tick reverts, naming the layout
(`deep: the tick array is not laid out as Raydium's`, or `Crema's`).

```text
orcaWhirlpoolStopped(slot, trader, amountIn, priceLimit, minOut, recipient, stop): Uint256
```

A pool's swap costs compute units for every initialized tick it crosses, and a walk that crosses
enough runs the whole cook out of them (one Solana transaction has 1,400,000). For a program written
with the venue namespaces the `sauce` command works each swap's stop out as it builds the cook: it
reads the pool's tick arrays, counts the initialized ticks its walk to its limit crosses, prices
them from a table measured on each venue's program with three more crossings kept back, and gives
the pool whose walk buys the most per unit its whole walk first, then the next from what is left. A
pool the rest does not cover is compiled to the Stopped form, held short of its limit, its start
bound three tick-spacing positions past its price then; one it cannot pay for at all is skipped. A
walk whose limit takes it past where the furthest array begins, on Raydium's code or Crema, is
compiled to the Stopped form too, with that array's deep tick, held or not.
Where no stop binds, the program is the plain one. A swap in a loop whose count is written out
(`for (let i = 0; i < 3; i++)`) is charged its own units for each run, and its walk once; in a loop
whose count is a value or a negative number, or more runs than one cook pays for, no pool is held,
and the command says so. This lowers the risk of running out, and does not
remove it: a held pool crosses at most three more initialized ticks than were priced while the
ticks in its way stay as they were read (a position opened inside its walk meanwhile adds one), but
a pool that walks its whole way is not checked, and a price that moves further before the cook lands can
cost it more. `sauce simulate` and `sauce run` check the stops in a simulation and tighten them if
the cook would still run out, and print a line for each pool a stop held or skipped; `sauce tx`
takes them from the table alone, so its cook can differ from the one `sauce simulate` reports.

Three more forms, for a program that wants less:

- **At a limit in the pool's own terms**, `<venue>AtLimit`, for those nine and `invariantAtLimit`
  and `openbookV2AtLimit`, and Manifest's book, `manifest`, which has no limit:
  `(slot, trader, amountIn, limit, minOut, recipient)`, `limit` the sqrt price the pool's swap takes
  (Phoenix's order price in ticks, OpenBook's `priceLots, orders`; `0` none, where the venue takes
  that). No fee is read, so an adaptive-fee
  whirlpool trades there, and `minOut` rides in the venue's own least-out field where it has one.
  At a limit a slot may carry accounts past its nine: a Raydium-layout pool's bitmap extension,
  Invariant's program authority, OpenBook's oracles.
- **The instruction alone**, `<venue>Cpi(program, accounts, source, amountIn, …)`, on the accounts
  in the venue's own order: it checks the program, reads only the paying account, and returns what
  it paid.
- **Its data alone**, `<venue>Data(amountIn, …)`, for a program that sends it with `svm.call` on
  accounts it writes itself: the cheapest form, a few thousand compute units over a hand-built
  instruction. `@eco-incorp/sauce/svm`'s `routerSvmAccountOrder` and `routerSvmAccounts` give each
  instruction's accounts in order.

```sauce chain=solana
import { orcaWhirlpool } from "@sauce/router";

function main(
  program: Account,
  pool: Account<Writable>,
  config: Account,
  vaultA: Account<Writable>,
  vaultB: Account<Writable>,
  extra: Account<Writable>,
  ticks0: Account<Writable>,
  ticks1: Account<Writable>,
  ticks2: Account<Writable>,
  authority: Account<Signer>,
  source: Account<Writable>,
  payMint: Account,
  buyMint: Account,
  tokenProgram: Account,
  token2022: Account,
  memo: Account,
  output: Account<Writable>,
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
): Uint256 {
  const slot = [program, pool, config, vaultA, vaultB, extra, ticks0, ticks1, ticks2];
  const trader = [authority, source, payMint, buyMint, tokenProgram, token2022, memo];
  return orcaWhirlpool(slot, trader, amountIn, priceLimit, minOut, output);
}
```

A program carries only the venues it calls: one venue's function is about 2.1 KB of program, past
one transaction, so the program is staged (`sauce-solana`).

## Exact input on Solana

Every other Solana venue `@sauce/router` serves swaps exactly `amountIn`, with no price limit: the
venue takes the whole input or the transaction fails. Each has three functions:

```text
raydiumCpSwapData(amountIn, minOut): bytes
raydiumCpSwapCpi(program, accounts, source, amountIn, minOut): Uint256
raydiumCpSwap(slot, trader, amountIn, minOut, recipient): Uint256
```

The venues: `raydiumCpSwap`, `gamma`, `raydiumAmmV4`, `orcaLegacyTokenSwap`, `tokenSwapV1`,
`orcaV1`, `penguin`, `stepn`, `saros`, `fluxbeam`, `dexlab`, `meteoraDammV2`, `meteoraDammV1`,
`aldrin`, `omnipair`, `saber`, `saberDecimalsWrapper`, `stabbleStableSwap`, `stabbleWeightedSwap`,
`mercurial`, `perena`, `metadaoFutarchy`, `solfiV1`, `solfiV2`, `hadron`, `taurusfi`, `riptide`,
`denali`, `gavel`, `tesserav`, `flint`, `deriverse`, `goonfiV2`, `meteoraDbc`, `trends`, `heaven`,
`virtuals`, `xorca`, `solayer`, `voltr`, `vaultLiquidUnstake`, `hyloStabilityPool`, `huma`,
`heliumTreasury` and `meteoraDlmm`.

| Venues                           | What to know                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solfiV1` through `goonfiV2`     | market makers pricing off their own oracle, quote or book; they refuse a swap on a quote gone stale, which a swap cannot see first. SolFi v1's pools all hold an empty vault, its liquidity moved to SolFi v2 |
| `meteoraDbc` through `virtuals`  | bonding curves; Virtuals only sells its token                                                                                                                                                                 |
| `xorca` through `heliumTreasury` | stake, deposit, unstake or redeem at the venue's own rate: xORCA only stakes, the liquid-unstake vault only unstakes, Huma only deposits, Helium's treasury only redeems                                      |

- **`<venue>Data`** is the venue's instruction data alone, for a program that sends it itself:
  `svm.call(program, [accounts…], raydiumCpSwapData(amountIn, minOut))`, the cheapest form.
  `minOut` is the venue's own least out, written as given. Where the data says the direction it is
  the last argument (`aToB`, `paysBase` or `xToY`); Perena's take the two tokens' indices too.
- **`<venue>Cpi`** sends that data on `accounts`, the venue's own list in its order, and returns
  what `source` paid.
- **The account order is the SDK's**: `routerSvmAccountOrder(venue, { aToB })` and
  `routerSvmAccounts(venue, { aToB }, refs)` from `@eco-incorp/sauce/svm` name and build it, and
  `ROUTER_SVM_VENUES` gives each venue's program and functions. A program compiled for one trade
  builds its accounts from them and never writes a venue's order itself.
- **`slot`** is the venue's own accounts, its program first and the pool second, then the rest in
  the order the venue's comment in the library gives; a pool's accounts for each token come in the
  pool's own order, and the function reads which one is paid from `payMint`. **`trader`** and
  **`recipient`** are the limit functions' own. It returns what the recipient received, held to
  `minOut` and at least 1, or `0` having moved nothing for a missing slot, no input, and what the
  venue refuses that it can see first (swaps switched off, an empty side, dust).
- **Cost**, measured on the released engine: a `Data` form about 3,300 compute units more than its
  data written by hand, a `Cpi` form about 7,500 more, and the slot forms about 1,400 more for each
  account they read out of `slot` or `trader`.

A function cannot list more than sixteen accounts, nor a number that varies (`meteoraDlmm` fills
seventeen in place, so its slot carries two bin arrays). `scaleAmm`, `pumpswap`,
`bonkswap`, `guacswap`, `sarosDlmm`, `raydiumLaunchlab`, `runnerRodeo`, `scaleVmm`,
`jupiterLendEarn`, `hylo`, `carrot`, `mswap`, `perpsJlp`, `sanctumInfinity` and `archer`, and
Jupiter Perpetuals' JLP mint, swap with more, so they have only their `Cpi` and `Data` forms:
`scaleAmmCpi`, `pumpswapCpi`, `bonkswapCpi`, `guacswapCpi`, `sarosDlmmCpi`,
`raydiumLaunchlabCpi`, `runnerRodeoCpi`, `scaleVmmCpi`, `jupiterLendEarnCpi`, `hyloCpi`,
`carrotCpi`, `mswapCpi`, `perpsJlpCpi`, `perpsJlpMintCpi`, `sanctumInfinityCpi`, `archerCpi`,
`scaleAmmData`, `pumpswapData`, `bonkswapData`, `guacswapData`, `sarosDlmmData`,
`raydiumLaunchlabData`, `runnerRodeoData`, `scaleVmmData`, `jupiterLendEarnData`, `hyloData`,
`carrotData`, `mswapData`, `perpsJlpData`, `perpsJlpMintData`, `sanctumInfinityData` and
`archerData`.

**No function at all**: One Intro, BisonFi, the Sanctum stake pools, pump.fun's bonding curve, Boop,
Moonit, Quantum, Obsidian, AlphaQ, WOOFi and Metric. A Pot cannot swap at the first nine (the stake
pools and the three curves settle in native SOL) nor the next three (they admit only routers on
their own list), and WOOFi's and Metric's swaps cannot be proven. `routerSvmAccountOrder` and
`routerSvmDataTemplate` still give their instruction, for a program that can send it. pump.fun's is
unverified against its current programs, upgraded after the capture it is held to: check it
against the deployed program before sending it.

## Pitfalls

- **No price limit** (`0`) leaves `minOut` the only bound, and an empty pool then costs a full tick
  walk. Set a real limit near the price.
- **A limit on the wrong side** reverts `SPL` (EVM) or fails the whole cook (Solana): take it from
  the `sauce price` block of the direction you trade.
- **The pair reversed in `sauce price`.** The first token is the one priced.
- **Unspent input left in the Pot after a partial fill.** Return `amountIn` less what was taken.
- **Sweeping the Pot's whole balance** on an owner's Pot. Return only this leg's rest.
- **A paid-first venue expected to refund.** It consumes all of its input or reverts.
- **A `minOut` of `0` in a real run**, or a `woofi` call without a positive one.
- **A pool's mid or stale price as the reference.** Use the best fee-inclusive price among pools
  with liquidity.

## Files

- [examples/swap-leg.sauce.ts](examples/swap-leg.sauce.ts): one guarded Uniswap V3 leg that
  returns its unspent input.
- [examples/solana-swap.sauce.ts](examples/solana-swap.sauce.ts): a swap at one Orca whirlpool by
  its namespace, the pool found by its key, what arrived forwarded.
- [examples/swaps.mts](examples/swaps.mts) compiles the leg and pins the library's functions and
  their argument order, the Router's entry points, their price parameters and callbacks, and on
  Solana the functions, their arguments and size, and the namespace example's accounts.
