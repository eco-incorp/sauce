# `@sauce/router`

[Documentation](../README.md) · [SauceScript](../concepts/saucescript.md) · [Actions](../guides/actions.md)

`@sauce/router` is a SauceScript library for swapping: one function per venue. Every function takes
its pool, tokens and amount as **run-time arguments**, so a program can choose them while it runs —
spend what an earlier call returned, read a balance, loop over a list of pools — and every function
returns the amount of `tokenOut` the recipient received.

```js
import { curve, uniswapV2 } from "@sauce/router";
import { balanceOf } from "@sauce/token";

// Ethereum: sell every WETH the Pot holds on Uniswap V2, then the USDC that returns for USDT in
// Curve's 3pool, and keep it. The tokens, the factory and the pool are the registry's names; the
// amounts are only known when this runs.
//
//   sauce run router-swap.sauce.ts --chain ethereum --keystore <keystore> --args <minOut>
//
//   minOut: Uint256   the least USDT to keep, in its smallest units (6 decimals): below it the
//                     whole transaction reverts
function main(minOut: Uint256) {
  const pair = UniswapV2.Factory.getPair(WETH, USDC);
  const sold = balanceOf(WETH, ctx.self());
  const received = uniswapV2(pair, WETH, USDC, sold, 3000, 0, ctx.self());
  // USDC is the 3pool's coin 1 and USDT its coin 2.
  curve(Curve.ThreePool, USDC, USDT, received, 1, 2, false, minOut, ctx.self());
}
```

The SDK carries the library and serves it to every compile it makes — a route body, an intent, an
[action program](../guides/actions.md) — so an import is all a program needs. [router-swap.ts](../examples/router-swap.ts)
compiles this one.

It is the one implementation of a swap at these venues: an action such as `uniswapV2Swap` is a
call into it, so a JSON action program and a hand-written program trade a venue through the same
code. On Solana the library is a different set of functions: one per venue whose swap stops at a
price limit, see [On Solana](#on-solana), and one per venue that swaps an exact input, see
[Exact input on Solana](#exact-input-on-solana).

## Functions

Every function takes its arguments in one order — the pool, the two tokens, the amount, then the
venue's own facts, then the floor and the recipient — and returns the amount received:

```text
venue(pool, tokenIn, tokenOut, amountIn, ...facts, minOut, recipient): Uint256
```

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

and a `try` form of each, with the same arguments as the function it names: `tryUniswapV2`,
`tryCurve`, `tryBalancerV2`, `tryDodoV2`, `tryTraderJoeLB`, `tryWoofi`, `tryUniswapV3`,
`tryUniswapV4`, `tryMaverickV2`, `tryInfinityCL` and `tryInfinityBin` — see
[what a swap may not do](#what-a-swap-may-not-do).

Addresses are `Address`, amounts and the other numbers `Uint256`, and `uint256Indices` a `bool`.

- **`amountIn`** is what the Pot pays. Every swap is **exact input**; nothing here expresses an
  exact-output swap.
- **`minOut`** is the least the swap may deliver; below it the whole program reverts. `0` sets no
  floor, except for `woofi`, which requires a positive one. Where the venue enforces a floor
  itself — Curve's `min_dy`, the Balancer Vault's `limit`, WooPPV2's `minToAmount` — `minOut` is
  that floor; otherwise the function checks it against the amount the venue reports.
- **`recipient`** receives the output; `ctx.self()` keeps it in the Pot.
- **The return value** is what the recipient received: the amount the pool or the Router reports,
  or, for Curve, whose 3pool-era pools report nothing, the Pot's balance change.

## How each venue is reached

Uniswap V2 and its forks, Curve, Balancer V2, DODO V2, Trader Joe LB and WOOFi never call back:
each function pays the pool and calls it directly, so it runs in any Pot. It either pushes the input
first (V2, DODO, LB, WOOFi) or approves exactly the input for the pool to pull (Curve, the Vault),
which leaves a zero allowance.

Uniswap V3 and its forks, Uniswap V4, Maverick V2 and PancakeSwap Infinity pools re-enter their
caller mid-swap to be paid, which a program cannot answer. Those functions call the Pot's Router — `ctx.self()`, whose
fallback delegatecalls it — and the Router answers the callback, paying from the Pot exactly what
the pool asks for, up to `amountIn`. The library checks V3 and Maverick token pairs. These functions
require generation 4, whose unsigned exact-input methods return `(amountInUsed, amountOut)`.
It answers Synthra V3 and UnitFlow V3 callbacks too. A private Pot runs the Router it was minted
with until its owner moves it, unless its Router was fixed at creation; see [the Pot's Router](../concepts/architecture.md#a-pots-router).

Every token write is `@sauce/token`'s, with OpenZeppelin `SafeERC20` semantics: a token that
returns nothing (USDT) works, one that returns `false` reverts the program, and a standing
allowance is reset to zero before a new one is set.

## Direction and orientation

Each function works out which side it trades from its own arguments, while the program runs, and
reverts rather than trade a side the arguments contradict:

- a Uniswap V2 pair's direction is the sort order of `tokenIn` and `tokenOut` — its `token0` is the
  lower address — and so is a Uniswap V4 pool's;
- `dodoV2` takes the pool's `baseToken` and `quoteToken`, sells base when `tokenIn` is the base
  token and quote when it is the quote token, and reverts unless the two tokens are those two. The
  side cannot come from address order, and the wrong one does not revert at the pool: it prices the
  side it was told to sell, sees none of it, and keeps the input;
- `traderJoeLB` takes the pair's `tokenX` and `tokenY` the same way;
- the Router checks a V3 or Maverick pool's tokens itself.

The facts are the caller's, like the pool address: take them from the pool.

## What a swap may not do

**A swap consumes its whole input or reverts; nothing is refunded.** Each pay-first pool spends all
it is paid or reverts — a V2 pair and a DODO V2 pool book their whole balance, an LB pair reverts
`LBPair__OutOfLiquidity` rather than fill part of an input, WooPPV2 books exactly the amount pushed —
and only an uncaught revert unwinds a push. So no function catches its pool's failure after paying
it. (Through the Router, a price limit or a pool that runs out can leave part of `amountIn` unspent;
it stays in the Pot.)

The `try` forms are the one way to get a swap that may fail without reverting the program, and they
lose nothing either: a `try` that cannot swap returns `0` having moved nothing, and the program
goes on. A swap that ran returns at least 1, so `0` always means nothing moved. That holds three
ways:

- `tryUniswapV2`, `tryTraderJoeLB`, `tryDodoV2` and `tryWoofi` check, before anything moves, that
  the pool takes the whole input at the floor — `minOut`, and at least 1 — from the V2 reserves,
  LB's `getSwapOut`, DODO V2's `querySellBase`/`querySellQuote` or WooPPV2's `query`. A pool with
  no code, or whose view reverts, is skipped. Otherwise the swap runs uncaught, so a failure the
  check did not foresee still reverts;
- `tryCurve` and `tryBalancerV2` catch the pool's failure and reset the approval to zero: the pool
  pulls the input and enforces the floor, at least 1, inside the call that is caught;
- `tryUniswapV3`, `tryUniswapV4`, `tryMaverickV2`, `tryInfinityCL` and `tryInfinityBin` catch the
  Router's call, inside which the Router pays the pool. A pool that has no code, is not the named
  pair's (V3, Maverick), or whose swap the pool or the Router refuses (a key no pool has, a price
  limit behind the pool's price) is skipped. The generation-4 Router takes no floor, so a swap that
  ran is held to one afterwards: what the recipient's `tokenOut` balance gained (its native balance
  for the zero address) must reach `minOut`, and at least 1, or the program reverts, because a swap
  that took input and delivered nothing (an input the pool keeps as its fee) cannot be undone. A
  swap that ran and moved nothing either way, in a pool with no liquidity in range, is skipped: the
  Router's own `amountInUsed`, what it paid out of the Pot, tells the two apart. With no price
  limit, an empty pool costs a full tick walk before it is skipped (about 10 million gas for an
  Infinity CL pool of tick spacing 2); pass a `sqrtPriceLimitX96` to bound it.

DODO V2 charges its fee by the transaction's origin, which a program cannot read, so `tryDodoV2`
asks the view for the Pot's fee. Where a pool's fee model tells the two apart, the swap can deliver
other than the quote, and below the floor it reverts.

## Venues

- **Uniswap V2** prices the output from the pair's reserves with the Sauce Router's own
  constant-product math and takes exactly that, so the pair's K check holds for a correctly stated
  fee and reverts for one stated too low. `feePpm` is the pair's LP fee in parts per million: 3000
  (0.30%) for Uniswap V2 and its forks that charge it, which `0` also means; 2500 for PancakeSwap
  V2; 1,000,000 or more reverts. An input past the reserve's `uint112` width reverts at the pair.
- **Uniswap V3** sends `amountIn` positive, the pool's exact-input sign. A non-zero
  `sqrtPriceLimitX96` stops the swap at that price.
- **Uniswap V4**'s pool key is `tokenIn` and `tokenOut` in sort order — native ETH is the zero
  address, which sorts first and which the Pot pays from its own balance — with the pool's `fee`,
  `tickSpacing` and `hooks`. Pass unsigned `amountIn`; the generation-4 Router handles V4's negative
  exact-input convention internally.
- **Curve** calls the pool's 4-argument `exchange(i, j, dx, min_dy)`. `uint256Indices` picks the
  CryptoSwap spelling over the StableSwap and NG one (`int128` indices). The pool pays the Pot, which
  forwards the output when `recipient` is not the Pot.
- **Balancer V2** swaps GIVEN_IN through the chain's Vault, `0xBA12222222228d8Ba445958a75a0704d566BF2C8`
  where Balancer deployed it, with `poolId` the pool's 32-byte id and internal balances off.
- **DODO V2** covers DVM, DPP and DSP pools. Legacy V1 pairs are the `dodoV1Swap` action's.
- **Trader Joe LB** amounts are `uint128`.
- **WOOFi** is the WooPPV2 itself, not its WooRouterV2. It prices from an oracle, so `minOut` is
  required, and it reverts when its reserve, notional cap or oracle refuses the trade.
- **Maverick V2** swaps over the pool's full tick range.
- **PancakeSwap Infinity**'s pool key is `tokenIn` and `tokenOut` in sort order — native is the zero
  address, which sorts first and which the Pot pays from its own balance — with the pool's
  `poolManager` (the CL or bin pool manager), `fee`, `parameters` (its packed tick spacing or bin
  step and hook permissions) and `hooks`; `vault` is the Infinity Vault the Router locks. A CL swap
  takes a price limit; a bin swap has none, and its input is an `int128` to the pool.

## Choose the venue at run time

Because every argument is a run-time value, one compiled program can serve every route over a set
of venues: give it the legs as arguments, and let it pick each function as it goes.

```js
import { balancerV2, curve, uniswapV2, uniswapV3 } from "@sauce/router";

// One compiled program for any route over four venues: each leg names its venue, pool and tokens,
// and the program picks the function while it runs, spending what the previous leg returned.
interface Leg {
  venue: Uint256; // 0 Uniswap V2, 1 Uniswap V3, 3 Curve, 4 Balancer V2; any other reverts
  pool: Address; // the pair, the pool, or the Balancer Vault
  tokenIn: Address;
  tokenOut: Address;
  i: Uint256; // Curve's coin indices, in a StableSwap (int128) pool
  j: Uint256;
  poolId: Uint256; // Balancer's pool id
}

function main(legs: Leg[], amountIn: Uint256, minOut: Uint256): Uint256 {
  let out = amountIn;
  for (let k = 0; k < legs.length; k = k + 1) {
    const leg = legs[k];
    if (leg.venue == 0) {
      out = uniswapV2(leg.pool, leg.tokenIn, leg.tokenOut, out, 0, 0, ctx.self());
    } else if (leg.venue == 1) {
      out = uniswapV3(leg.pool, leg.tokenIn, leg.tokenOut, out, 0, 0, ctx.self());
    } else if (leg.venue == 3) {
      out = curve(leg.pool, leg.tokenIn, leg.tokenOut, out, leg.i, leg.j, false, 0, ctx.self());
    } else if (leg.venue == 4) {
      out = balancerV2(leg.pool, leg.tokenIn, leg.tokenOut, out, leg.poolId, 0, ctx.self());
    } else {
      throw "router-route: unknown venue";
    }
  }
  require(out >= minOut);
  return out;
}
```

[router-route.ts](../examples/router-route.ts) compiles it once and appends a route as its
arguments. Nothing about the legs is known to the compiler, so the bytecode — and its hash — is the
same for every route.

## From JSON

Each [action](../guides/actions.md#swaps) at these venues is a call into this library with the
action's fields as its arguments. Inside an action program, a swap whose output a later action
spends delivers to the Pot. Its tokens and contracts may be names (`"USDC"`, `"UniswapV3.Factory"`),
which are the program globals of those names, and three may name their pool by key instead of
`pool`: the program reads the pool from the factory and passes it to the function
([pools by key](../guides/actions.md#pools-by-key)).

| Action            | Function      | Facts it carries                                                                      |
| ----------------- | ------------- | ------------------------------------------------------------------------------------- |
| `uniswapV2Swap`   | `uniswapV2`   | `pool` or `factory`, optional `feePpm`                                                |
| `uniswapV3Swap`   | `uniswapV3`   | `pool`, or `factory` + `fee` or `tickSpacing`; optional `sqrtPriceLimitX96`           |
| `uniswapV4Swap`   | `uniswapV4`   | `poolManager`, `fee`, `tickSpacing`, optional `hooks` and `sqrtPriceLimitX96`         |
| `curveSwap`       | `curve`       | `pool`, `i`, `j`, `indexType` (`"int128"` or `"uint256"`)                             |
| `balancerV2Swap`  | `balancerV2`  | `vault`, `poolId`                                                                     |
| `dodoV2Swap`      | `dodoV2`      | `pool`, `baseToken`, `quoteToken`                                                     |
| `traderJoeLBSwap` | `traderJoeLB` | `pool` or `factory` + `binStep`; `tokenX`, `tokenY`, read from the pair when left out |
| `woofiSwap`       | `woofi`       | `pool`                                                                                |
| `maverickV2Swap`  | `maverickV2`  | `pool`                                                                                |

## Compile it yourself

`compileSauceRoute`, the chain helpers, `openRoute` and the actions package resolve `@sauce/router`
with no option. A raw `compile()` resolves it through the SDK's own resolvers, which serve the
library, the `@sauce/token` it imports and the pool ABIs it binds from memory:

```ts
import { compile, resolveSdkModule, resolveSdkPackage } from "@eco-incorp/sauce/compiler";

export function compileWithRouter(source: string) {
  const entry = new TextEncoder().encode(source);
  return compile({
    target: "evm",
    resolve: (path) => (path === "main.js" ? entry : resolveSdkModule(path)),
    resolvePackage: (specifier) => resolveSdkPackage(specifier),
  });
}
```

The package also ships the library's files under `sdk/dist/std/router/`, beside `@sauce/token`'s,
for a toolchain that resolves packages off disk: `router.evm.js` and `router.svm.js`, which the
compiler picks by target. No function is in both, so one the target's arm lacks fails at its
import, naming it: "`woofi` is not exported by module …" on Solana, "`trySwap` …" on an EVM chain.

## On Solana

On Solana `@sauce/router` swaps at the venues whose swap takes a price limit that stops it and
leaves the rest of the input, the venues of [the distributed swap on Solana](../guides/solana-distributed-swap.md),
and at Manifest's book. Each venue's swap comes in four forms:

| Form                                         | Takes                                                   | Returns                      |
| -------------------------------------------- | ------------------------------------------------------- | ---------------------------- |
| at a price: `try<Venue>`                     | `(slot, trader, amountIn, maxPrice, minOut, recipient)` | what the recipient received  |
| at the pool's own limit: `try<Venue>AtLimit` | `(slot, trader, amountIn, limit, minOut, recipient)`    | what the recipient received  |
| the instruction alone: `<venue>Cpi`          | `(program, accounts, source, amountIn, limit, …)`       | what the paying account paid |
| the instruction's data: `<venue>Data`        | `(amountIn, limit, …)`                                  | the data, to send yourself   |

with a plain form of each `try` form (`raydiumClmm`, `raydiumClmmAtLimit`, …) that reverts where
it returns `0`. Every form sends the same instruction for the same amount, limit and floor. The
`try` forms build it with the venue's `…Data`; `…Cpi` writes the same bytes itself, because a call
into `…Data` would cost it about 2k compute units (Phoenix's excepted, which is cheaper through
`phoenixData`).

| Venue            | Program                                        | At a price           | At its own limit            | Its instruction      | Its data                                   |
| ---------------- | ---------------------------------------------- | -------------------- | --------------------------- | -------------------- | ------------------------------------------ |
| Raydium CLMM     | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | `tryRaydiumClmm`     | `tryRaydiumClmmAtLimit`     | `raydiumClmmCpi`     | `raydiumClmmData`                          |
| PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` | `tryPancakeswapClmm` | `tryPancakeswapClmmAtLimit` | `pancakeswapClmmCpi` | `pancakeswapClmmData`                      |
| Byreal           | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2`  | `tryByreal`          | `tryByrealAtLimit`          | `byrealCpi`          | `byrealData`                               |
| Stabble CLMM     | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` | `tryStabbleClmm`     | `tryStabbleClmmAtLimit`     | `stabbleClmmCpi`     | `stabbleClmmData`                          |
| Orca Whirlpools  | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`  | `tryOrcaWhirlpool`   | `tryOrcaWhirlpoolAtLimit`   | `orcaWhirlpoolCpi`   | `orcaWhirlpoolData`, `orcaWhirlpoolV2Data` |
| Cropper          | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` | `tryCropper`         | `tryCropperAtLimit`         | `cropperCpi`         | `cropperData`                              |
| DefiTuna         | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9`  | `tryDefituna`        | `tryDefitunaAtLimit`        | `defitunaCpi`        | `defitunaData`                             |
| Crema            | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` | `tryCrema`           | `tryCremaAtLimit`           | `cremaCpi`           | `cremaData`                                |
| Phoenix          | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`  | `tryPhoenix`         | `tryPhoenixAtLimit`         | `phoenixCpi`         | `phoenixData`                              |
| Invariant        | `HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt` |                      | `tryInvariantAtLimit`       | `invariantCpi`       | `invariantData`                            |
| OpenBook v2      | `opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb`  |                      | `tryOpenbookV2AtLimit`      | `openbookV2Cpi`      | `openbookV2Data`, `openbookV2LotsData`     |
| Manifest         | `MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms`  |                      | `tryManifest` (no limit)    | `manifestCpi`        | `manifestData`                             |

and `trySwap`/`swap`, which take a pool at any of the nine venues priced the first way and read its
venue from the program that owns it.

```text
trySwap(slot: Account[], trader: Account[], amountIn, maxPrice, minOut, recipient: Account): Uint256
```

- **`slot`** is the pool's accounts, the System program for any the venue does not take:
  `[program, pool, config, vaultA, vaultB, extra, ticks0, ticks1, ticks2]`.
  [`sauce pools`](../guides/cli.md#sauce-pools) prints each pool's slot for the direction paid. Some
  venues take accounts past the nine: a Raydium-layout pool (Raydium CLMM, PancakeSwap CLMM, Byreal,
  Stabble CLMM) its tick-array bitmap extension tenth, which its swap reads past the pool's default
  range (a slot of nine sends none); Invariant its program's authority tenth (its `config` is the
  program's state, `extra` the pool's tickmap, its ticks the tick accounts the swap may cross);
  OpenBook v2 its two oracles, the program itself for one the market has not (its `config` is the
  market's authority, `extra` its event heap, its ticks its bids, asks and the System program);
  Manifest's `config` is the System program, which its swap takes. An Orca pool's `extra`, its oracle, must be writable for an adaptive fee and for a pool with a Token-2022 mint, whose `swap_v2` declares it writable whatever the fee. Crema refuses a tick array its
  map does not mark and Invariant takes only the ticks it crosses, so each is passed the slot's first
  tick array and each after it until a System program.
- **`trader`** is `[authority, source, payMint, buyMint, tokenProgram, token2022, memo]`: the
  authority that signs (the Pot, through the Kitchen), the token account paid from, the two mints,
  the SPL Token and Token-2022 programs and the memo program. Both are arrays because a function
  other than `main` keeps at most about sixteen values in use at once. Manifest and OpenBook take the
  authority as their payer, so for them it must be writable.
- **`amountIn`** is the most the pool may take. The rest of it stays in `source`.
- **`maxPrice`** is the most one unit bought may cost, fee included: payToken base units per
  buyToken base unit, times 1e18. The function reads the pool's fee and gives the pool its own
  limit, so its last unit, fee paid, costs `maxPrice`: a concentrated-liquidity pool's sqrt price
  limit moved by `√(1 − fee)`, a Phoenix order's price `maxPrice ÷ (1 + fee)` in ticks.
- **`limit`** is the pool's own: the sqrt price its swap takes as the pool keeps it (a Q64.64 root;
  on Invariant a root times 10^24), Phoenix's order price in its market's ticks, OpenBook's in its
  lots (`priceLots`, then `orders`, the most resting orders it may match). No fee is read for it, so
  whatever fee the pool charges stays inside it: an adaptive-fee whirlpool and a Byreal pool with
  fees of its own trade at a limit, and a limit computed to keep a walk inside the tick arrays a slot
  carries keeps it there however the fee moves. `0` is no limit: the program's own bound on Raydium's
  code, Orca and DefiTuna, an order at any price on Phoenix and OpenBook, and on Invariant only selling
  token X. Cropper's and Crema's programs take no `0`; give them their own bound. Invariant's
  program does not stop at its limit: a swap that reaches it with input left is refused (custom
  error `0x1778`), and the whole transaction with it, so there `amountIn` must fit inside the limit.
- **`minOut`** is the least a swap that ran may deliver; below it the whole program reverts. At a
  pool's own limit it rides in the venue's own least-out field where the instruction has one
  (Raydium's code and the whirlpools' `other_amount_threshold`, Crema's `amount_limit`, Manifest's
  `out_atoms`), so the venue refuses a swap below it itself; Phoenix's, Invariant's and OpenBook's
  recipient balance is held to it.
- **`recipient`** is the token account the output lands in; Crema and Phoenix pay only into the
  authority's own.

Each venue's function requires the slot's program to be its venue's and the pool's owner before it
reads the pool, because the authority signs the swap; `trySwap` requires the slot's program to own
the pool and that owner to be one of the nine. These are the caller's accounts, so each reverts
rather than skips: a slot naming another program, a pool of another venue (`not a Crema pool`, …)
or of none (`not a supported venue's pool`), a pool that is not the pair, and a limit an order cannot
carry (a sqrt price limit past its 128 bits, which cut to its field would be no limit at all; Phoenix's past 64 bits, OpenBook's past 63 or `orders` past 255). Only the System program
itself as the pool is a missing slot, which a `try` form skips.

A failed call into another program fails the whole Solana transaction and cannot be caught, so a
`try` form checks before anything moves and returns `0`, having moved nothing, for a missing slot
(the System program as its pool), no input, a pool whose swaps are off, a paused pool or a market
not open for taking, a pool with no liquidity at its price, a pool already at or past its limit, an
input too small to buy one unit at the pool's price after its fee (judged at a limit by the pool's
base fee), an input smaller than one of a market's lots, and, at a price, a fee that is more than one
rate (a dynamic or adaptive fee, or a Byreal pool's own) and a market limit too large for an order's
64-bit price. The price only worsens as a pool sells, so the estimate is the most the input could
buy: dust an earlier pool left (an atom, which the fee takes whole) is skipped, never handed to a
venue that would keep it or refuse it. A Phoenix or OpenBook order whose book has no offer within
its price is placed and fills nothing, so it returns `0` too, nothing having moved. A swap that ran
returns at least 1, held to `minOut` and at least 1, and reverts below it. A failure the checks do
not foresee, such as a tick array missing from the slot or an Invariant input past its limit, fails
the transaction.

```js
import { trySwap } from "@sauce/router";

// One pool, any of the nine venues: up to amountIn of payMint for buyMint, never more than maxPrice
// a unit with the fee, and at least minOut, else the whole transaction reverts.
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
  return trySwap(slot, trader, amountIn, maxPrice, minOut, output);
}
```

### The instruction alone

`<venue>Cpi` is a venue's swap instruction and nothing around it: it takes the accounts in the
venue's own order, the paying account beside them, what the instruction carries and, where its
accounts do not say it, its direction. It checks the program, reads the paying account before and
after, and returns what that account paid, reverting (`debit`) if the venue took more than
`amountIn`. The instruction is the one a caller would build by hand, byte for byte; an amount of `0`
is the venue's to refuse, so skip the call.

`<venue>Data` is that instruction's data alone, for a program that sends it with `svm.call` itself:
it takes what the instruction carries and its direction, checks only that each field can carry its
value (a floor past 64 bits, a sqrt price limit past 128 bits, Phoenix's limit past 64 bits, OpenBook's price or lots past 63 or `orders` past
255 revert), and returns the bytes. The program names the venue's program and reads whatever
balances it wants. It is the cheapest form: an account list passed to a function, as `…Cpi` takes it,
is built as an array first, and one written into `svm.call` is not.

| Function                                                              | After `program, accounts, source`       | `…Data` takes                                                                                                                        | `accounts`, in order                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raydiumClmmCpi`, `pancakeswapClmmCpi`, `byrealCpi`, `stabbleClmmCpi` | `amountIn, limit, minOut`               | `amountIn, limit, minOut`                                                                                                            | the authority, the `AmmConfig`, the pool, the paying and receiving token accounts, the input and output vault, the observation account, SPL Token, Token-2022, the memo program, the input and output mint, then the bitmap extension (if any) and the tick arrays                                |
| `orcaWhirlpoolCpi`                                                    | `amountIn, limit, minOut, aToB`         | `amountIn, limit, minOut, aToB` (`swap`'s, and `swap_v2`'s)                                                                          | for `swap` (both mints SPL Token's): SPL Token, the authority, the pool, token A's account and vault, token B's, three tick arrays, the oracle; for `swap_v2`: token A's and B's token programs, the memo program, the authority, the pool, mint A, mint B, then as `swap` from token A's account |
| `cropperCpi`                                                          | `amountIn, limit, minOut, aToB`         | `amountIn, limit, minOut, aToB`                                                                                                      | as a whirlpool's `swap`                                                                                                                                                                                                                                                                           |
| `defitunaCpi`                                                         | `amountIn, limit, minOut, aToB`         | `amountIn, limit, minOut, aToB`                                                                                                      | token A's and B's token programs, the memo program, the authority, the pool, mint A, mint B, token A's and B's accounts, vault A, vault B, three tick arrays                                                                                                                                      |
| `cremaCpi`                                                            | `amountIn, limit, minOut, aToB`         | `amountIn, limit, minOut, aToB`                                                                                                      | the `clmm_config`, the pool, mint A, mint B, token A's and B's accounts, vault A, vault B, the tick-array map, the authority, SPL Token, the marked tick arrays                                                                                                                                   |
| `phoenixCpi`                                                          | `amountIn, ticks, paysBase`             | `amountIn, lot, ticks, paysBase`                                                                                                     | the program, the log authority, the market, the authority, the base and quote token accounts, the base and quote vaults, SPL Token                                                                                                                                                                |
| `invariantCpi`                                                        | `amountIn, limit, xToY`                 | `amountIn, limit, xToY`                                                                                                              | the program's state, the pool, its tickmap, the X and Y token accounts, the X and Y reserves, the authority, the program's authority, SPL Token, the ticks it may cross                                                                                                                           |
| `manifestCpi`                                                         | `amountIn, minOut, paysBase`            | `amountIn, minOut, paysBase`                                                                                                         | the authority, the market, the System program, the base and quote token accounts, the base and quote vaults, the base token program, the base mint, the quote token program, the quote mint                                                                                                       |
| `openbookV2Cpi`                                                       | `amountIn, priceLots, orders, paysBase` | `amountIn, baseLot, quoteLot, priceLots, orders, paysBase`; `openbookV2LotsData`: `baseLots, quoteLots, priceLots, orders, paysBase` | the authority twice (signer and penalty payer), the market, its authority, bids, asks, the base and quote vaults, the event heap, the base and quote token accounts, the two oracles, SPL Token, the System program, the program                                                                  |

`minOut` rides in the venue's floor; Phoenix's, Invariant's and OpenBook's instructions carry none,
and their `…Cpi` and `…Data` take none. Phoenix and OpenBook size the order in their market's lots:
`…Cpi` reads them from the market, the instruction's third account, and `…Data` takes them (`lot`,
the paid token's lot size on Phoenix; `baseLot` and `quoteLot` on OpenBook). `openbookV2LotsData`
takes the order in lots, divided already, for a program that knows the market's lot sizes when it
compiles: the side paid bounds the order, so give the other side its most, `0x7fffffffffffffff` over
its lot size. An input under one lot is no order: `phoenixCpi` returns `0` for it, and a caller of
`phoenixData` skips it.

The two `try` forms return what the recipient received, and `…Cpi` what the paying account paid,
each one number. A program that wants both reads the other itself:

```js
import { defitunaCpi } from "@sauce/router";

// A DefiTuna swap at a sqrt price limit computed beforehand, A to B: what source paid, through
// defitunaCpi, and what output received, read around it. accounts is the instruction's own list.
function main(
  program: Account,
  tokenProgramA: Account,
  tokenProgramB: Account,
  memo: Account,
  authority: Account<Signer>,
  pool: Account<Writable>,
  mintA: Account,
  mintB: Account,
  source: Account<Writable>,
  output: Account<Writable>,
  vaultA: Account<Writable>,
  vaultB: Account<Writable>,
  ticks0: Account<Writable>,
  ticks1: Account<Writable>,
  ticks2: Account<Writable>,
  amountIn: Uint256,
  sqrtLimitX64: Uint256,
  minOut: Uint256,
): Uint256 {
  const accounts = [
    tokenProgramA, tokenProgramB, memo, authority, pool, mintA, mintB, source, output, vaultA,
    vaultB, ticks0, ticks1, ticks2,
  ];
  const before = svm.sload(output, 64, 8).toLe();
  const spent = defitunaCpi(program, accounts, source, amountIn, sqrtLimitX64, minOut, true);
  const received = svm.sload(output, 64, 8).toLe() - before;
  return (spent << 128) | received;
}
```

With `…Data`, the same swap reads both itself, and costs a few thousand compute units less:

```js
import { defitunaData } from "@sauce/router";

function main(
  program: Account,
  tokenProgramA: Account,
  tokenProgramB: Account,
  memo: Account,
  authority: Account<Signer>,
  pool: Account<Writable>,
  mintA: Account,
  mintB: Account,
  source: Account<Writable>,
  output: Account<Writable>,
  vaultA: Account<Writable>,
  vaultB: Account<Writable>,
  ticks0: Account<Writable>,
  ticks1: Account<Writable>,
  ticks2: Account<Writable>,
  amountIn: Uint256,
  sqrtLimitX64: Uint256,
  minOut: Uint256,
): Uint256 {
  const data = defitunaData(amountIn, sqrtLimitX64, minOut, true);
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(output, 64, 8).toLe();
  svm.call(
    program,
    [tokenProgramA, tokenProgramB, memo, authority, pool, mintA, mintB, source, output, vaultA,
     vaultB, ticks0, ticks1, ticks2],
    data,
  );
  const spent = held - svm.sload(source, 64, 8).toLe();
  require(spent <= amountIn, "debit");
  return (spent << 128) | (svm.sload(output, 64, 8).toLe() - before);
}
```

A program compiled for one trade knows the venue's accounts before it runs. The SDK names them in
the order each instruction takes them, so a code generator need not keep its own copy of that order:
`routerSvmAccountOrder(venue, options)` from `@eco-incorp/sauce/svm` lists each account's name and
whether the instruction writes it and it signs, and `routerSvmAccounts(venue, options, refs)` builds
the list from a value for each name (an address, or whatever reference the generator resolves
later). `options` is the direction (`aToB`: the pool's first token is paid — token 0 or A,
Invariant's X, a market's base) and, where the venue takes them, Orca's `swap_v2` (`v2`, whose
oracle is always writable), an adaptive-fee whirlpool, whose classic `swap` writes its oracle too
(`adaptive`), a Raydium-layout pool's bitmap
extension (`bitmapExtension`), and how many tick arrays Crema, or ticks Invariant, takes
(`tickArrays`). `ROUTER_SVM_VENUES` gives each venue's program and its `…Data` and `…Cpi` functions.

```ts
import { routerSvmAccounts, ROUTER_SVM_VENUES } from "@eco-incorp/sauce/svm";

const accounts = routerSvmAccounts(
  "defituna",
  { aToB: true },
  {
    tokenProgramA: TOKEN_PROGRAM,
    tokenProgramB: TOKEN_PROGRAM,
    memo: MEMO_PROGRAM,
    authority: pot,
    pool,
    mintA: SOL,
    mintB: USDC,
    source,
    recipient,
    vaultA,
    vaultB,
    tickArray0,
    tickArray1,
    tickArray2,
  },
);
// [{ name: "tokenProgramA", ref: …, writable: false, signer: false }, …], in the instruction's order
const program = ROUTER_SVM_VENUES.defituna.program;
```

The data, too, can be written when the program is generated. The checks `<venue>Data` makes on every
swap (a floor past 64 bits, a sqrt price limit past 128, a book's price or order count past its
field) cost a few hundred compute units each, and the compiler does not fold them away for a literal
argument: a program passing its limit as a literal still runs them. `routerSvmDataTemplate(venue,
options)` makes them once, in TypeScript, throwing for a field past its slot, and returns the bytes
around the amount, so the program writes `prefix ‖ u64le(amountIn ÷ divisor) ‖ suffix` and pays
nothing for the encoding beyond the concatenation. Its bytes are `<venue>Data`'s for the same
fields; its options are the account order's direction and Orca's `v2`, then the fields the venue's
instruction carries (`limit`, `minOut`; Phoenix `ticks` and the paid token's `lot`; OpenBook
`priceLots`, `orders`, `baseLot` and `quoteLot`).

```ts
import { routerSvmDataTemplate } from "@eco-incorp/sauce/svm";

const { prefix, suffix, divisor } = routerSvmDataTemplate("defituna", {
  aToB: true,
  limit: sqrtLimitX64,
  minOut,
});
// The program: prefix.concat((amountIn / divisor).toBytesLe(8), suffix), prefix and suffix as hex
// literals.
```

### Size and compute

A program carries the venues it calls and no other: one venue's function at a price or at a limit
is about 0.9 to 2.0 KB of program, its instruction alone about 0.4 to 0.5 KB, its data alone about
0.2 to 0.4 KB, `trySwap` all nine about 6.1 KB. A program that knows its venue calls that venue's
function, and keeps `trySwap` for slots whose venue it learns as it runs. Past one transaction a
program is staged in a code buffer, as `sauce run` does. [The distributed swap on Solana](../guides/solana-distributed-swap.md)
is one `trySwap` call per pool.

Reading an account out of an array is among the dearest steps in a program, so a form that takes a
slot pays for every account it lays out; `…Cpi` and `…Data` read none, and `…Data` does not even
build its accounts into an array. Measured on each fixture pool with the released engine (v12-svm
1.3.0, devnet build, in LiteSVM), a swap of ten tokens: the venue's own compute, the whole cook of
the instruction eco-incorp/sauce-recipes builds for it, sent by hand (its bytes, the amount patched
in, and the paying account read around it), and what each form adds to that cook. `…Data` and
`…Cpi` are compiled for the one trade, as the hand-built CPI is: every argument but the amount a
literal. A whole cook moves by a few thousand units with its accounts' addresses; what a form adds,
measured on the same accounts, does not.

| Venue (pool, way)                     | Venue CU | Hand-built CPI | `…Data` |  `…Cpi` | `try…AtLimit` | `try…` at a price |
| ------------------------------------- | -------: | -------------: | ------: | ------: | ------------: | ----------------: |
| Raydium CLMM (SOL/USDC, 0→1)          |   48,274 |        114,662 |  +3,185 |  +6,781 |       +97,269 |          +111,032 |
| PancakeSwap CLMM (SOL/USDC, 0→1)      |   70,098 |        136,486 |  +3,185 |  +6,781 |       +97,270 |          +112,194 |
| Byreal (USDC pool, 0→1)               |   72,927 |        139,281 |  +3,185 |  +6,781 |       +96,308 |          +112,687 |
| Orca Whirlpools (SOL/USDC, A→B)       |   30,166 |         87,749 |  +3,793 |  +9,579 |       +83,951 |          +109,498 |
| Orca Whirlpools, adaptive fee (B→A)   |   42,792 |        100,130 |  +3,953 |  +9,931 |       +85,649 |           skipped |
| Cropper (SOL/USDC, B→A)               |   51,207 |        108,790 |  +3,953 |  +7,433 |       +82,154 |           +94,050 |
| DefiTuna (SOL/USDC, A→B)              |   50,589 |        112,128 |  +3,776 |  +7,256 |       +80,714 |           +91,805 |
| Crema (SOL/USDC, B→A)                 |   75,506 |        137,178 |  +3,575 |  +7,055 |       +83,957 |          +109,789 |
| Phoenix (SOL/USDC, selling base)      |   22,729 |         91,297 |  +6,437 | +14,318 |       +61,360 |                   |
| Invariant (USDC/USDT, X→Y)            |   62,133 |        122,300 |  +3,498 |  +6,978 |       +76,219 |                   |
| Manifest (SOL/USDC, selling base)     |   13,122 |         68,694 |  +2,967 |  +6,563 |       +55,410 |                   |
| OpenBook v2 (BONK/USDC, selling base) |   31,112 |         92,145 | +12,068 | +17,830 |       +82,208 |                   |

`…Data`'s few thousand units are its fields' packing and checks: the floor's 64-bit check and the
limit's 128-bit one (about 600 units each), the direction, one `toBytesLe`. `…Cpi` adds the program's check, building its account list into an
array, and the call. A book's data carries more: Phoenix's divides the input by its lot size, and
OpenBook's word has six fields, two of them chosen by the price. `openbookV2LotsData`, its lots
divided when the program is compiled, adds +8,173 where `openbookV2Data`, dividing, adds +12,068.
`routerSvmDataTemplate`'s bytes add nothing: they are the hand-built CPI's.
The `try` forms pay for reading the slot: the pool's owner, its state for the skips, and every
account they lay out.

Stabble CLMM runs Raydium's code and its forms cost what Raydium's do. The forms' cost does not grow
with the ticks a swap crosses; the venue's does. To the window's edge, with more input than the
window holds, Raydium CLMM's SOL/USDC swap crosses 6 ticks for 64,198 units of its own, PancakeSwap's
57 for 105,004, Crema's 1,423 for 122,377, and each form costs what it cost for ten tokens past
that.

## Exact input on Solana

The Solana arm's other functions swap exactly `amountIn` at one pool, with no price limit: the venue
takes the whole input, or the transaction fails. Each venue has four functions:

```text
raydiumCpSwap(slot: Account[], trader: Account[], amountIn, minOut, recipient: Account): Uint256
tryRaydiumCpSwap(slot, trader, amountIn, minOut, recipient): Uint256
raydiumCpSwapCpi(program: Account, accounts: Account[], source: Account, amountIn, minOut): Uint256
raydiumCpSwapData(amountIn, minOut): bytes
```

- **`<venue>Data`** is the venue's instruction data, and nothing else. The caller sends it itself,
  `svm.call(program, [accounts…], raydiumCpSwapData(amountIn, minOut))`, and reads what it wants.
  It is the cheapest form, and the one a program compiled for one trade should use.
- **`<venue>Cpi`** sends that data on `accounts`, the instruction's own accounts in the venue's
  order. It checks only the program, reads only `source`, and returns what `source` paid.
- **`<venue>`** swaps on a slot and returns what the recipient received, held to `minOut` and at
  least 1. It reverts below that.
- **`try<Venue>`** first checks what it can see before the swap. It returns `0`, having moved
  nothing, for a missing slot (the System program as its pool), no input, and each refusal of the
  venue's listed below. Otherwise it is `<venue>`.

`minOut` in `…Data` and `…Cpi` is the venue's own least out, written as given; a venue whose swap
carries none takes no `minOut` there (Bonkswap, Guacswap, the Saber decimal wrapper). Where the data
says the direction, they take it as their last argument: `aToB` paying the pool's first token
(token 0 or A, the decimal wrapper's underlying token, Scale AMM's buy), `paysBase` the base token
(Aldrin, MetaDAO futarchy, PumpSwap's sell), `xToY` token X (Bonkswap, Guacswap). Perena's take the
two tokens' indices among the pool's ten, `perenaData(amountIn, inIndex, outIndex, minOut)`. A
`minOut` past 64 bits, or a Perena index past its byte, reverts; `amountIn` is written as its
low 64 bits.

**The account order is the SDK's.** `@eco-incorp/sauce/svm`'s `routerSvmAccountOrder(venue,
{ aToB })` names each account of a venue's swap in order, with whether the instruction writes it and
whether it signs, and `routerSvmAccounts(venue, { aToB }, refs)` builds the list from a value for
each name, an address or a placeholder a code generator resolves later. `ROUTER_SVM_VENUES` keys
the venues by the recipes' names (`raydium-cp-swap`, `meteora-damm-v1-cp`, …) and gives each one's
program and its `…Data` and `…Cpi` functions. Names are the pool's: `vaultA`, `mintA` and
`tokenProgramA` are the pool's first token's whatever the direction; `source` is the paying token
account, `recipient` the one the output lands in, `authority` the account that signs (the Pot).
PumpSwap takes `poolV2` for a pool with a coin creator, and Scale AMM `beneficiaries`, the number
of its fee beneficiaries.

**So is the data.** `routerSvmDataTemplate(venue, options)` writes an exact-input venue's data
around the amount when the program is generated, as it does a limit venue's: `prefix ‖
u64le(amountIn) ‖ suffix`, its divisor 1, the bytes `<venue>Data` writes for the same fields. Its
options are the account order's `aToB`, `minOut` where the swap carries a floor, and Perena's
`inIndex` and `outIndex`. It throws a RangeError for a floor past 64 bits or an index past its
byte, and refuses an option the venue's swap does not carry and the way a one-way venue does not
swap, as its account order does. The program pays for none of it: those bytes cost what the
recipes' hand-built data does, the "by hand" column below.

`trader` and `recipient` are the same as the limit functions take, `[authority, source, payMint,
buyMint, tokenProgram, token2022, memo]`, with the recipient the token account the output lands in.
`slot` is the venue's own accounts: its program first, the pool second, then the rest in the
venue's order below. Where a pool keeps an account per token, such as its two vaults, the slot
carries both in the **pool's** order. The function works out which one is paid from `payMint`, so
one slot serves both directions. Each token's program is the one that owns its mint.

| Functions              | Venue                 | Program                                        | Slot after `[program, pool]`                                                                                                         |
| ---------------------- | --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `raydiumCpSwap`        | Raydium CP-Swap       | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | `authority, ammConfig, vault0, vault1, observation`                                                                                  |
| `gamma`                | Gamma                 | `GAMMA7meSFWaBXF25oSUgmGRwaW6sCMFLmBNiMSdbHVT` | `authority, ammConfig, vault0, vault1, observation`                                                                                  |
| `raydiumAmmV4`         | Raydium AMM v4        | `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | `authority, coinVault, pcVault`                                                                                                      |
| `orcaLegacyTokenSwap`  | Orca legacy pools     | `9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `tokenSwapV1`          | SPL Token Swap        | `SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8`  | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `orcaV1`               | Orca v1               | `DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `penguin`              | Penguin               | `PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP`  | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `stepn`                | STEPN (Dooar)         | `Dooar9JkhdZ7J3LHN3A7YCuoGRUggXhQaG4kijfLGU2j` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `saros`                | Saros                 | `SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr`  | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `fluxbeam`             | Fluxbeam              | `FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `dexlab`               | Dexlab                | `DSwpgjMvXhtGn6BsbqmacdBZyfLj6jSWf3HJpdJtmg6N` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `meteoraDammV2`        | Meteora DAMM v2       | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`  | `authority, vaultA, vaultB, eventAuthority`                                                                                          |
| `meteoraDammV1`        | Meteora DAMM v1       | `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB` | `aVault, bVault, aTokenVault, bTokenVault, aVaultLpMint, bVaultLpMint, aVaultLp, bVaultLp, protocolFeeA, protocolFeeB, vaultProgram` |
| `aldrin`               | Aldrin                | `AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6` | `poolSigner, poolMint, baseVault, quoteVault, feeAccount`                                                                            |
| `omnipair`             | Omnipair              | `omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE`  | `rateModel, futarchyAuthority, vault0, vault1, eventAuthority`                                                                       |
| `saber`                | Saber                 | `SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ`  | `authority, vaultA, vaultB, adminFeeA, adminFeeB`                                                                                    |
| `saberDecimalsWrapper` | Saber decimal wrapper | `DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB` | `wrapperMint, underlyingVault` (the wrapper as the pool)                                                                             |
| `stabbleStableSwap`    | Stabble stable swap   | `swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ`  | `withdrawAuthority, vault, vaultAuthority, vaultProgram, vaultTokenA, vaultTokenB, beneficiaryTokenA, beneficiaryTokenB`             |
| `stabbleWeightedSwap`  | Stabble weighted swap | `swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW`  | `withdrawAuthority, vault, vaultAuthority, vaultProgram, vaultTokenA, vaultTokenB, beneficiaryTokenA, beneficiaryTokenB`             |
| `mercurial`            | Mercurial             | `MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky`  | `authority, vault0, vault1` (a two-token pool; `mercurialCpi` takes any)                                                             |
| `perena`               | Perena (Numéraire)    | `NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P`  | `numeraireConfig, vaultA, vaultB` (the two tokens traded)                                                                            |
| `metadaoFutarchy`      | MetaDAO futarchy      | `FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq` | `baseVault, quoteVault, eventAuthority` (the DAO as the pool)                                                                        |
| `solfiV2`              | SolFi v2              | `SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF`  | `oracle, registry, vaultA, vaultB, instructionsSysvar`                                                                               |
| `hadron`               | Hadron                | `HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8` | `assetConfigA, assetConfigB, growingA, vaultA, vaultB, globalConfig, feeVaultA, feeVaultB, clock, metadataA`                         |
| `taurusfi`             | TaurusFi              | `9VX8EKBg6vM6tA68xaDsPkbrx26XConZjkQmhVApUptc` | `vault0, vault1, vaultAuthority, globalConfig, globalAuthority, instructionsSysvar` (the price account as the pool)                  |
| `riptide`              | Riptide               | `riptK81hDxhe5pW5jSzSM9iRA8azgEgLJ4dXkPtBS7j`  | `vaultA, vaultB, instructionsSysvar, dontFront`                                                                                      |
| `denali`               | Denali                | `DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4` | `vaultA, vaultB, oracle, globalConfig`                                                                                               |
| `gavel`                | Gavel                 | `srAMMzfVHVAtgSJc8iH6CfKzuWuUTzLHVCE81QU1rgi`  | `logAuthority, baseVault, quoteVault`                                                                                                |
| `tesserav`             | Tessera V             | `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH`  | `authority, vaultA, vaultB, instructionsSysvar, config, oracle`                                                                      |
| `flint`                | Flint                 | `FLiNTXPwppyoJabCoxc2uiiRygAHpmMXajiDXo2Ub1z`  | `marketB, vaultA, vaultB, instructionsSysvar` (market A as the pool)                                                                 |
| `deriverse`            | Deriverse             | `DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD` | `assetVault, crncyVault, bidsTree, bidOrders, asksTree, askOrders, lines, maps, clientInfos` (the instrument as the pool)            |
| `goonfiV2`             | GoonFi v2             | `goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE`  | `vaultA, vaultB, oracle, globalConfig, instructionsSysvar, validator`                                                                |

Each row names four functions: the one listed, its `try` form, its `Cpi` form and its `Data`
form. Raydium CP-Swap
and Gamma require token 0 to be the lower-key mint. A Stabble pool's `vaultTokenA` and `vaultTokenB`
are the vault's accounts for the two tokens traded, in either order. Each beneficiary account is the
vault beneficiary's for that token. Raydium AMM v4 and Mercurial read the direction from the paying
and receiving accounts themselves. Perena finds each mint's index among the pool's ten tokens, and
writes both mints, so they are attached writable.

SolFi v2, Hadron, TaurusFi, Riptide, Denali, Gavel, Tessera V, Flint, Deriverse and GoonFi v2 are
proprietary market makers: each prices off its own oracle, quote or book, which a keeper keeps
fresh, and refuses a swap on a quote gone stale. A `try` form can't see that, so a stale quote fails
the transaction. `instructionsSysvar` is the Instructions sysvar and `clock` the Clock sysvar.
Riptide's `dontFront` is `jitodontfront111111111111111111111111111111`, and GoonFi v2's `validator`
is the vote account `J1to1yufRnoWn81KYg1XkTWzmKjnYSnmE2VY8DGUJ9Qv`. A Hadron fee vault is the fee
treasury's token account for that token. A Flint market and its vault are one per token. Tessera V
sells only its token A. SolFi v2, TaurusFi, Deriverse and GoonFi v2 write the authority, so it is
attached writable, and Deriverse requires the authority's associated token accounts. Hadron and
TaurusFi pay wrapped SOL into, and take it out of, native wrapped-SOL accounts.

Six venues take more accounts in their swap than a function can list. A function other than
`main` builds a list of at most sixteen accounts. These venues have only their `Cpi` and `Data`
forms, on the list the caller's `main` builds:

| Functions     | Venue        | Program                                        |
| ------------- | ------------ | ---------------------------------------------- |
| `scaleAmm`    | Scale AMM    | `SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA`  |
| `pumpswap`    | PumpSwap     | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`  |
| `bonkswap`    | Bonkswap     | `BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p` |
| `guacswap`    | Guacswap     | `Gswppe6ERWKpUTXvRPfXdzHhiCyJvLadVvXGfdpBqcE1` |
| `meteoraDlmm` | Meteora DLMM | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`  |
| `sarosDlmm`   | Saros DLMM   | `1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE`  |

A PumpSwap buy takes the authority's volume accumulator, and it has to exist already. A Pot can't
pay to create it, because the System program won't move lamports out of an account that holds data.
PumpSwap's `init_user_volume_accumulator` takes any payer. Bonkswap and Guacswap require the paying
and receiving accounts to be the authority's associated token accounts. PumpSwap, Bonkswap,
Guacswap and Scale AMM write the authority, so it is attached writable. Scale AMM takes one account
per fee beneficiary. A Meteora DLMM swap crosses bins only as far as the bin arrays its list ends
with, from the active bin onwards in the trade's direction, and a Saros DLMM swap only within the
two bin arrays around its active bin; a trade too large for them fails.

**A swap spends exactly `amountIn`**, with three exceptions. The Token Swap program and its forks,
Fluxbeam and Dexlab spend what their curve rounds the input to, and so does Aldrin. The difference
is a few units, and it stays in `source`; a `Cpi` form returns what was actually paid. A Fluxbeam or
Dexlab mint with a transfer fee keeps the fee out of what the pool receives.

**`minOut`** goes into the venue's own floor where its swap takes one, so the venue refuses less
itself: as given in `…Data` and `…Cpi`, and at least 1 in `<venue>` and `try<Venue>` (Denali's and
Hadron's as given there too, 0 included), which also hold what the recipient received to `minOut`
and to at least 1. The Saber decimal wrapper, Bonkswap, Guacswap, TaurusFi, Riptide and Flint have
no floor of their own; for these, a `Data` or `Cpi` caller enforces the floor itself.

**What each `try` form skips** before the swap:

- the Raydium CP-Swap and Gamma forms skip swaps switched off, a pool not open yet, an empty side,
  and dust;
- the Raydium AMM v4 form skips a pool that does not swap (a status other than 1, 6 or 7, or 7
  before its open time), an empty side, and dust;
- the Token Swap forms, Fluxbeam and Dexlab skip an uninitialized pool, an empty side, and dust;
- the Meteora DAMM v2 form skips a disabled pool, and a pool with no liquidity;
- the Meteora DAMM v1 form skips a disabled pool;
- the Aldrin and Omnipair forms skip an empty side, and dust;
- the Saber form skips a paused pool and an empty side;
- the Stabble forms skip an inactive pool and an empty side;
- the Mercurial form skips an empty side;
- the Perena form skips a paused pool and an empty side;
- the MetaDAO futarchy form skips a DAO not in its spot state, and an empty side;
- the Saber decimal wrapper form skips a withdrawal the vault cannot pay;
- the SolFi v2, Hadron, TaurusFi, Riptide, Denali, Gavel, Tessera V, Flint, Deriverse and GoonFi v2
  forms skip an empty side.

"Dust" is an input too small to buy one unit at the pool's price after its fee. It is estimated from
the vaults' balances. A venue's own refusal that the checks don't foresee still fails the
transaction.

Every form but `…Data` requires the program to be its venue's before the authority signs into it.
It reverts naming the venue (`not a Raydium CP pool`, …). Each refuses a `minOut` past the venues' 64
bits (`minOut past 64 bits`). A pool of another venue, or one that isn't the pair, is the venue's own
to refuse.

**Compute.** Measured on the released engine (v12-svm 1.3.0; its devnet and mainnet builds measure
the same), each against an empty program with the same accounts, with the venue's own units
excluded. "By hand" is the recipes' template: the venue's data written around the amount
(`prefix.concat(amount.toBytesLe(8), suffix)`) and sent with `svm.call` on `main`'s own accounts.
`…Data` costs about 3,300 units more, the call into it and its packed word; `…Cpi` about 7,500 more,
because an account list passed to a function is built as an array first, where one written into
`svm.call` is not. A `<venue>` or `try<Venue>` function reads its accounts out of `slot` and
`trader`, and each account it hands the venue costs about 1,400 units more than one of `main`'s own:

| Venue                             | By hand | `<venue>Data` | `<venue>Cpi` | `<venue>` | `try<Venue>` |   Venue's own |
| --------------------------------- | ------: | ------------: | -----------: | --------: | -----------: | ------------: |
| Raydium CP-Swap                   |  14,745 |        18,025 |       22,173 |    50,980 |       71,691 |        24,285 |
| Gamma                             |  14,745 |        18,025 |       22,173 |    50,980 |       71,289 |        67,050 |
| Raydium AMM v4                    |  12,528 |        15,808 |       19,812 |    33,601 |       55,433 |        15,538 |
| Orca legacy (constant product)    |  13,382 |        16,662 |       20,810 |    42,588 |       58,501 |        44,359 |
| SPL Token Swap and its forks      |  13,382 |        16,662 |       20,816 |    42,588 |       58,501 | 22,461–49,511 |
| Fluxbeam                          |  15,196 |        18,476 |       22,630 |    59,492 |       75,408 |        68,950 |
| Dexlab                            |  15,180 |        18,460 |       22,614 |    59,665 |       75,581 |        57,377 |
| Meteora DAMM v2                   |  14,916 |        18,196 |       22,344 |    55,402 |       62,969 |        13,782 |
| Meteora DAMM v1 (stable)          |  15,728 |        19,008 |       23,156 |    54,110 |       59,153 |       104,290 |
| Aldrin                            |  13,382 |        18,051 |       22,089 |    44,469 |       56,902 |        48,184 |
| Omnipair                          |  13,056 |        16,336 |       20,484 |    49,120 |       61,550 |        39,456 |
| Saber                             |  12,953 |        16,233 |       20,381 |    39,447 |       50,463 |        40,129 |
| Saber decimal wrapper             |  11,713 |        14,361 |       18,625 |    29,414 |       34,838 |        14,209 |
| Stabble stable and weighted swaps |  14,277 |        17,557 |       21,705 |    48,232 |       59,967 | 29,883–83,821 |
| Mercurial                         |  12,526 |        15,806 |       19,810 |    33,831 |       41,470 |        73,205 |
| Perena                            |  13,956 |        19,759 |       23,675 |    55,146 |       66,668 |       159,473 |
| MetaDAO futarchy                  |   9,250 |        14,262 |       18,294 |    36,975 |       48,172 |        43,808 |
| Scale AMM                         |  15,660 |        20,427 |       25,387 |           |              |        43,890 |
| PumpSwap                          |  17,945 |        22,800 |       28,688 |           |              |        73,361 |
| Bonkswap                          |  16,985 |        20,173 |       24,813 |           |              | 56,094–68,094 |
| Guacswap                          |  16,985 |        19,981 |       24,621 |           |              | 64,613–70,631 |
| Meteora DLMM                      |  15,518 |        18,798 |       22,946 |           |              |        40,225 |
| Saros DLMM                        |   9,529 |        14,187 |       18,241 |           |              |        53,053 |
| SolFi v2                          |  18,924 |        23,593 |       27,625 |    61,769 |       69,408 |        81,206 |
| Hadron                            |  16,108 |        21,692 |       25,608 |    58,889 |       66,528 |        31,027 |
| TaurusFi                          |  15,204 |        16,572 |       20,284 |    51,688 |       59,327 |       117,086 |
| Riptide                           |  15,039 |        17,791 |       21,387 |    57,312 |       64,951 |       531,428 |
| Denali                            |  14,276 |        19,163 |       23,195 |    54,367 |       62,006 |        23,501 |
| Gavel                             |  12,633 |        16,809 |       20,841 |    37,577 |       45,216 |        19,084 |
| Tessera V                         |  15,257 |        19,381 |       23,529 |    54,512 |       59,616 |        51,729 |
| Flint                             |  13,666 |        14,507 |       18,247 |    47,604 |       55,243 |         8,241 |
| Deriverse                         |  18,264 |        23,510 |       27,426 |    64,142 |       71,407 |        39,027 |
| GoonFi v2                         |  18,097 |        22,772 |       26,804 |    64,586 |       72,225 |        65,485 |

Each row is the first trade direction `svm-exact-in.e2e.test.ts` runs. The other direction is within
about 1,600 units. Perena's slot forms include the scan for its two tokens' indices. A venue's own
units move between runs with the accounts' addresses, by up to about 12,000 for Bonkswap; the
library's do not. A function is about 300 to 900 bytes of program.
