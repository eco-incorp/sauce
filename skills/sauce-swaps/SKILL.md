---
name: sauce-swaps
description: Swapping inside a Sauce program with @sauce/router — one function per venue (uniswapV2, uniswapV3, uniswapV4, curve, balancerV2, dodoV2, traderJoeLB, woofi, maverickV2, infinityCL, infinityBin, and a try form of each), every argument a run-time value, each returning what the recipient received and reverting below minOut; which venues are paid first and which call back through the Pot's Router, which pool families the Router's callbacks service (Uniswap V3 and forks, PancakeSwap V3, Algebra, Synthra, UnitFlow, Uniswap V4), exact input only, how a price limit produces a partial fill, PancakeSwap Infinity CL and bin pools, the guard that stops a leg from stranding input, and on Solana a function per price-limited venue (Raydium CLMM, Orca, Phoenix and six more) and trySwap for any. Use when the user wants a swap, trade, price limit, sqrtPriceLimitX96, min-out or slippage bound, a partial fill, "swap then …", or asks which venues Sauce can swap on.
---

# Swaps with `@sauce/router`

`@sauce/router` is the package's swap library: one SauceScript function per venue. A program
imports the ones it uses, and the package serves the library to every compile, so the import is all
it needs:

```sauce chain=base,arbitrum
import { uniswapV3 } from "@sauce/router";

// Sells `amount` of the Pot's WETH for USDC, paid to `recipient`: the user's wallet, or
// `ctx.self()` to keep the USDC in the Pot.
function main(amount: Uint256, sqrtPriceLimitX96: Uint256, minOut: Uint256, recipient: Address) {
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  uniswapV3(pool, WETH, USDC, amount, sqrtPriceLimitX96, minOut, recipient);
}
```

The last argument decides where the output ends: the wallet the user asked for, or the Pot, where
only another cook moves it. A later step that spends the output in the same program takes it in the
Pot.

Every argument is a run-time value, so a program can choose the pool, the direction and the amount
while it runs: spend what an earlier swap returned, read a balance, loop over a list of pools.

A tokenized stock (`SPCXc` on Base, `TSLAon` on Ethereum, `TSLAx` on Solana) is swapped like any token; its symbol
and what differs about it are in `sauce-globals`
([Tokenized stocks](../sauce-globals/SKILL.md#tokenized-stocks)).

## Functions

Every function takes its arguments in one order — the pool, the two tokens, the amount, the venue's
own facts, then the floor and the recipient — and returns the amount of `tokenOut` the recipient
received:

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

- **`amountIn`** is what the Pot pays. **Every swap is exact input.**
- **`minOut`** is the least the swap may deliver; below it the whole program reverts. `0` sets no
  floor, except for `woofi`, which requires a positive one.
- **`recipient`** receives the output; `ctx.self()` keeps it in the Pot.
- `feePpm` is a V2 pair's LP fee in parts per million (3000, which `0` also means, for Uniswap V2;
  2500 for PancakeSwap V2). `uniswapV4` takes the pool key's `fee`, `tickSpacing` and `hooks`, and
  builds the key from `tokenIn` and `tokenOut` in sort order. `uint256Indices` picks a Curve
  CryptoSwap pool's `uint256` coin indices over a StableSwap pool's `int128` ones.

Each venue has a `try` form — `tryUniswapV2`, `tryCurve`, `tryBalancerV2`, `tryDodoV2`,
`tryTraderJoeLB`, `tryWoofi`, `tryUniswapV3`, `tryUniswapV4`, `tryMaverickV2`, `tryInfinityCL`,
`tryInfinityBin` — that takes the same arguments as the function it names and returns `0`, having
moved nothing, instead of reverting when the swap cannot be made. A swap that ran returns at least
1, so `0` always means nothing moved:

- the forms of the venues paid first check the pool's own view before anything moves (the V2
  reserves, LB's `getSwapOut`, DODO V2's `querySellBase`/`querySellQuote`, WooPPV2's `query`), or
  catch the pool's failure and reset the approval (`tryCurve`, `tryBalancerV2`); a pool with no code
  is skipped;
- the forms that call the Router (V3, V4, Maverick, Infinity) catch the Router's call, so a pool with
  no code, a pool for another pair, a key no pool has and a swap the pool or the Router refuses are
  skipped. A swap that ran must then deliver `minOut`, and at least 1, or the whole program reverts:
  an input the pool kept (a dust amount it takes as its fee) cannot be given back. A swap that ran in
  a pool with no liquidity in range moved nothing either way, and returns `0`. With no price limit,
  an empty pool costs a full tick walk before it is skipped, millions of gas; pass a
  `sqrtPriceLimitX96` to bound it.

## How each venue is reached

**Paid first.** Uniswap V2 and its forks, Curve, Balancer V2, DODO V2, Trader Joe LB and WOOFi never
call back: the function pushes the input to the pool, or approves exactly the input for the pool to
pull, and calls it. Such a swap **consumes its whole input or reverts**; nothing is refunded.

**Called back.** Uniswap V3 and its forks, Uniswap V4, Maverick V2 and PancakeSwap Infinity pools
re-enter their caller mid-swap to be paid, which a program cannot answer. Those functions call the
**Pot's Router**, `ctx.self()`: the Pot's fallback delegatecalls the Router it is configured with
(`router()` on the Pot), so the Router runs in the Pot's context, holds the Pot's balances, and
answers the callback.
It services these callbacks:

- `uniswapV3SwapCallback`: Uniswap V3 and forks that keep the name, including Aerodrome Slipstream;
- `pancakeV3SwapCallback`: PancakeSwap V3;
- `algebraSwapCallback`: Algebra pools (Camelot V3, QuickSwap V3), whose `swap` has the same
  selector as Uniswap V3's;
- `synthraV3SwapCallback`, `unitFlowV3SwapCallback`: Synthra V3 and UnitFlow V3;
- `unlockCallback`: Uniswap V4;
- `maverickV2SwapCallback`: Maverick V2;
- `lockAcquired`: PancakeSwap Infinity, CL and bin pools alike.

So `uniswapV3` drives every one of those V3-style pools. Each callback is authenticated to the pool
being swapped, pays **once**, and pays only
the input the pool asks for, never more than `amountIn` (`InputExceedsAuthorized`).

Every token write is `@sauce/token`'s SafeERC20: a token that returns nothing (USDT) works, one that
returns `false` reverts the program.

**Direction is checked from the arguments.** A V2 pair's and a V4 pool's direction is the sort order
of `tokenIn` and `tokenOut`; `dodoV2` takes the pool's base and quote tokens and `traderJoeLB` its X
and Y tokens, and each reverts unless `tokenIn` and `tokenOut` are those two; the library checks a V3
pool's tokens. Take these facts from the pool, as you take the pool itself.

## Price limits and partial fills

`sqrtPriceLimitX96` is `floor(sqrt(token1Units / token0Units) * 2^96)`, with token0 the lower of
the two addresses, so one number means the same price on every V3-style pool of the pair and on V4
pools of the same two currencies. Selling token0 moves the price down, so the limit is a floor;
selling token1 moves it up, so it is a ceiling. It must lie strictly between `4295128739` and
`1461446703485210103287273052203988822378723970342` and on the far side of the pool's current
price, or the pool reverts `SPL`. A limit of `0` means none, which leaves `minOut` as the only
bound: set a real limit.

**Convert a price with `sauce price`**, which reads no network:
`sauce price --chain base WETH USDC 2686.5`. The price is **quote per base**: the first token
is the one priced, the second what it is priced in, so this is 2,686.5 USDC per WETH. Swapped,
`USDC WETH 2686.5` would mean 2,686.5 WETH per USDC, a limit nowhere near any pool. It prints the
pair's order on the chain (on Base WETH is token0, the lower address, and USDC token1) and two
blocks:

- **`sell`** (the base token in: WETH → USDC): its `sqrtPriceLimitX96` is a **floor**;
- **`buy`** (the base token out: USDC → WETH): its `sqrtPriceLimitX96` is a **ceiling**.

Each block also gives that direction's average floor `minAvgPrice`, output received per input
paid (`out * 1e18 >= minAvgPrice * spent`), and, the other way round, `maxPrice` and `maxAvgPrice`,
input paid per output bought, which the distributed swap takes (`sauce-distributed-swap`). Take the
limit from the block of the direction you trade. With an endpoint, `--pool <address>` reads the
price from that pool now.

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
| `InputTokenMismatch()`                   | the Router | the input token does not match the pool key and direction                                       |
| `InputExceedsAuthorized()`, `0x510db218` | the Router | the pool asked for more input than the exact input offered                                      |

A revert inside the program (a `require`, the library's `minOut` check) is the program's own; the
cook reverts as a whole either way.

## PancakeSwap Infinity

`infinityCL` and `infinityBin` swap PancakeSwap Infinity pools through the Router's own entry points,
the same way `uniswapV4` does a V4 pool: the key is built from `tokenIn` and `tokenOut` in sort order
with the pool's `poolManager`, `fee`, `parameters` and `hooks`, and `vault` is the Infinity Vault.
The entry points themselves, which a program can also call with the Router ABI the package serves
(`import { ISauceRouter } from "./artifacts/ISauceRouter.json"`, then `ISauceRouter.at(ctx.self())`),
take a positive unsigned exact input and return `(amountInUsed, amountOut)`. These signatures
require generation 4.

| Entry point                                                                               | Price bound         |
| ----------------------------------------------------------------------------------------- | ------------------- |
| `swapInfinityCL(vault, key, tokenIn, zeroForOne, amountIn, sqrtPriceLimitX96, recipient)` | `sqrtPriceLimitX96` |
| `swapInfinityBin(vault, key, tokenIn, swapForY, amountIn, recipient)`                     | none                |

## The guard (required on every leg)

The library checks `minOut`; what is left is the input a price limit left unspent:

1. Pass a `minOut` that is a `main` input, so a short fill reverts the whole transaction.
2. Pay the output to its recipient (`recipient` does it), or keep it in the Pot for the next step.
3. Send the rest of the input back to the user or a refund address: `amountIn` less what the
   swap took (the input balance before minus after), not the Pot's whole balance of the token,
   which on an owner's Pot may hold more of it for other uses.

[examples/swap-leg.sauce.ts](examples/swap-leg.sauce.ts) is exactly this for one Uniswap V3 pool.
Rehearse it, then run it, with the input in the Pot (or pulled in with `--fund`):

```sh
sauce simulate swap-leg.sauce.ts --chain base --owner <address> \
  --args <tokenIn> <tokenOut> 500 <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
sauce run swap-leg.sauce.ts --chain base --keystore <keystore> \
  --fund WETH:0.5 --args <tokenIn> <tokenOut> 500 <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
```

A swap is sent on a chain the initial release supports, Ethereum or Base here; on a preview chain
the leg compiles and simulates, and `sauce tx` and `sauce run` refuse it with the chain-support
request for that chain (`sauce-chains`).

For several venues under one price limit, use `sauce-distributed-swap`.

## On Solana

On Solana `@sauce/router` is one function per venue whose swap stops at a price limit and leaves
the rest of the input: `tryRaydiumClmm`, `tryPancakeswapClmm`, `tryByreal`, `tryStabbleClmm`,
`tryOrcaWhirlpool`, `tryCropper`, `tryDefituna`, `tryCrema` and `tryPhoenix` (an
immediate-or-cancel order on its book), and `trySwap`, which takes a pool at any of them and reads
its venue from the pool's owner. Each `try` form has a plain one (`raydiumClmm`, …, `phoenix`, and
`swap`) that reverts where it returns `0`. Every one takes the same arguments:

```text
trySwap(slot, trader, amountIn, maxPrice, minOut, recipient): Uint256
```

- **`slot`** is the pool's nine accounts, the System program for any the venue does not take:
  `[program, pool, config, vaultA, vaultB, extra, ticks0, ticks1, ticks2]`.
  `sauce pools --chain solana` prints each pool's slot for the direction paid, and
  `sauce-solana-distributed-swap` says what each account is per venue.
- **`trader`** is `[authority, source, payMint, buyMint, tokenProgram, token2022, memo]`: the
  authority that signs (the Pot), the token account paid from, the two mints, the two token
  programs and the memo program.
- **`maxPrice`** is the most one unit bought may cost, fee included: payToken base units per
  buyToken base unit, times 1e18. The function reads the pool's fee and stops the pool where its
  last unit, fee paid, costs `maxPrice`; the rest of `amountIn` stays in `source`.
- **`recipient`** is the token account the output lands in; Crema and Phoenix pay only into the
  authority's own. The function returns what it gained.

A `try` form returns `0` having moved nothing for a missing slot (the System program as its pool),
no input, a pool whose swaps are off, a paused pool or a market not open, a fee that is more than one
rate, an empty pool, a pool already past its limit, an input too small to buy one unit at the pool's
price after its fee (dust), and a book with no offer within it. A swap that
ran returns at least 1, and below `minOut` the cook reverts. A failed call into another program
fails the whole Solana transaction and cannot be caught, so these are checks made before the swap,
not a catch. The accounts are the caller's, so a pool that is not the pair, a slot whose program is
not the pool's owner, and a pool of another venue or of none revert; only the System program itself
as the pool is a missing slot.

A limit already in the pool's own terms takes a second form, `try<Venue>AtLimit` and its plain
`<venue>AtLimit`, for those nine and `tryInvariantAtLimit` and `tryOpenbookV2AtLimit`, and
Manifest's book, `tryManifest`, which has no limit: `(slot, trader, amountIn, limit, minOut,
recipient)`, `limit` the sqrt price the pool's swap takes (Phoenix's order price in ticks, OpenBook's
`priceLots, orders`; `0` none, where the venue takes that). No fee is read for it, so an adaptive-fee
whirlpool trades there, and `minOut` rides in the venue's own least-out field where it has one. A
third, `<venue>Cpi(program, accounts, source, amountIn, …)`, is the instruction alone on the accounts
in the venue's own order: it checks the program, reads only the paying account, and returns what it
paid. A fourth, `<venue>Data(amountIn, …)`, is that instruction's data alone, for a program that sends
it with `svm.call` on accounts it writes in itself: the cheapest form, a few thousand compute units
over a hand-built instruction. `@eco-incorp/sauce/svm`'s `routerSvmAccountOrder` and
`routerSvmAccounts` give each instruction's accounts in order. At a limit a slot may carry accounts
past its nine: a Raydium-layout pool's bitmap extension, Invariant's program authority, OpenBook's
oracles. At a price a slot is its nine.

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
  maxPrice: Uint256,
  minOut: Uint256,
): Uint256 {
  const slot = [program, pool, config, vaultA, vaultB, extra, ticks0, ticks1, ticks2];
  const trader = [authority, source, payMint, buyMint, tokenProgram, token2022, memo];
  return orcaWhirlpool(slot, trader, amountIn, maxPrice, minOut, output);
}
```

A program carries only the venues it calls: one venue's function is about 1.6 KB of program, and
`trySwap` all nine, about 4.4 KB, so a program that knows its venue calls that venue's function and
keeps `trySwap` for slots whose venue it learns as it runs. Either is past one transaction, so the
program is staged (`sauce-solana`). For one order over several pools under one price, use
`sauce-solana-distributed-swap`.

## Exact input on Solana

Every other Solana venue `@sauce/router` serves swaps exactly `amountIn`, with no price limit: the
venue takes the whole input or the transaction fails. Each has four functions:

```text
raydiumCpSwapData(amountIn, minOut): bytes
raydiumCpSwapCpi(program, accounts, source, amountIn, minOut): Uint256
raydiumCpSwap(slot, trader, amountIn, minOut, recipient): Uint256
tryRaydiumCpSwap(slot, trader, amountIn, minOut, recipient): Uint256
```

The venues: `raydiumCpSwap`, `gamma`, `raydiumAmmV4`, `orcaLegacyTokenSwap`, `tokenSwapV1`,
`orcaV1`, `penguin`, `stepn`, `saros`, `fluxbeam`, `dexlab`, `meteoraDammV2`, `meteoraDammV1`,
`aldrin`, `omnipair`, `saber`, `saberDecimalsWrapper`, `stabbleStableSwap`, `stabbleWeightedSwap`,
`mercurial`, `perena`, `metadaoFutarchy`, `solfiV1`, `solfiV2`, `hadron`, `taurusfi`, `riptide`,
`denali`, `gavel`, `tesserav`, `flint`, `deriverse`, `goonfiV2`, `meteoraDbc`, `trends`, `heaven`,
`virtuals`, `xorca`, `solayer`, `voltr`, `vaultLiquidUnstake`, `hyloStabilityPool`, `huma` and
`heliumTreasury`.

`solfiV1` through `goonfiV2` are market makers pricing off their own oracle, quote or book, and
refuse a swap on a quote gone stale, which a `try` form can't see. `meteoraDbc` through `virtuals`
are bonding curves; Virtuals only sells its token. SolFi v1's pools all hold an empty vault, its
liquidity moved to SolFi v2. `xorca` through `heliumTreasury` stake, deposit, unstake or redeem at
the venue's own rate; xORCA only stakes, the liquid-unstake vault only unstakes, Huma only deposits
and Helium's treasury only redeems. One Intro, BisonFi, the Sanctum stake pools, pump.fun's bonding
curve, Boop, Moonit, Quantum, Obsidian, AlphaQ, WOOFi and Metric have no function at all: a Pot
cannot swap at the first nine (the stake pools and the three curves settle in native SOL) nor at the
next three (they admit only routers on their own list), and WOOFi's and Metric's swaps cannot be
proven. `routerSvmAccountOrder` and `routerSvmDataTemplate` still give their instruction, for a
program that can send it. pump.fun's is unverified against its current programs, which were
upgraded after the capture it is held to: check it against the deployed program before sending it.

- **`<venue>Data`** is the venue's instruction data alone, for a program that sends it itself:
  `svm.call(program, [accounts…], raydiumCpSwapData(amountIn, minOut))`. It is the cheapest form.
  `minOut` is the venue's own least out, written as given. Where the data says the direction it is
  the last argument (`aToB`, `paysBase` or `xToY`); Perena's take the two tokens' indices too.
- **`<venue>Cpi`** sends that data on `accounts`, the venue's own account list in its order, and
  returns what `source` paid.
- **The account order is the SDK's**: `routerSvmAccountOrder(venue, { aToB })` and
  `routerSvmAccounts(venue, { aToB }, refs)` from `@eco-incorp/sauce/svm` name and build it, and
  `ROUTER_SVM_VENUES` gives each venue's program and functions by the recipes' venue names. A
  program compiled for one trade builds its accounts from them and never writes a venue's order
  itself.
- **`slot`** is the venue's own accounts, its program first and the pool second, then the rest in
  the order the venue's comment in the library gives. A pool's accounts for each token, such as
  its vaults, come in the pool's own order, and the function reads which one is paid from
  `payMint`.
- **`trader`** and **`recipient`** are the limit functions' own. The plain form returns what the
  recipient received, held to `minOut` and at least 1.
- **`try<Venue>`** returns `0` having moved nothing for a missing slot (the System program as its
  pool), no input, and what the venue refuses that it can see first (swaps switched off, an empty
  side, dust).

Measured on the released engine, a venue's `Data` form costs about 3,300 compute units more than
its data written by hand, its `Cpi` form about 7,500 more, and the slot forms about 1,400 more for
each account they read out of `slot` or `trader`.

A function cannot list more than sixteen accounts, nor a number that varies. `scaleAmm`, `pumpswap`,
`bonkswap`, `guacswap`, `meteoraDlmm`, `sarosDlmm`, `raydiumLaunchlab`, `runnerRodeo`, `scaleVmm`,
`jupiterLendEarn`, `hylo`, `carrot`, `mswap`, `perpsJlp`, `sanctumInfinity` and `archer`, and
Jupiter Perpetuals' JLP mint, swap with more, so they have only their `Cpi` and `Data` forms:
`scaleAmmCpi`, `pumpswapCpi`, `bonkswapCpi`, `guacswapCpi`, `meteoraDlmmCpi`, `sarosDlmmCpi`,
`raydiumLaunchlabCpi`, `runnerRodeoCpi`, `scaleVmmCpi`, `jupiterLendEarnCpi`, `hyloCpi`,
`carrotCpi`, `mswapCpi`, `perpsJlpCpi`, `perpsJlpMintCpi`, `sanctumInfinityCpi`, `archerCpi`,
`scaleAmmData`, `pumpswapData`, `bonkswapData`, `guacswapData`, `meteoraDlmmData`, `sarosDlmmData`,
`raydiumLaunchlabData`, `runnerRodeoData`, `scaleVmmData`, `jupiterLendEarnData`, `hyloData`,
`carrotData`, `mswapData`, `perpsJlpData`, `perpsJlpMintData`, `sanctumInfinityData` and
`archerData`.

## Example

[examples/swaps.mts](examples/swaps.mts) compiles the leg and pins the library's functions, the
Router's entry points, their price parameters and the callbacks above against what the package
serves.
