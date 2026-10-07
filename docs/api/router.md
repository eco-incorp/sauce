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
code. On Solana the library is a different set of functions, one per venue whose swap stops at a
price limit; see [On Solana](#on-solana).

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
carry (Phoenix's past 64 bits, OpenBook's past 63 or `orders` past 255). Only the System program
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
value (a floor past 64 bits, Phoenix's limit past 64 bits, OpenBook's price past 63 or `orders` past
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

### Size and compute

A program carries the venues it calls and no other: one venue's function at a price or at a limit
is about 0.9 to 2.0 KB of program, its instruction alone about 0.3 to 0.6 KB, its data alone about
0.2 to 0.4 KB, `trySwap` all nine about 5.8 KB. A program that knows its venue calls that venue's
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
| Raydium CLMM (SOL/USDC, 0→1)          |   48,274 |        111,662 |  +2,585 |  +6,182 |       +96,071 |          +110,433 |
| PancakeSwap CLMM (SOL/USDC, 0→1)      |   70,098 |        133,486 |  +2,585 |  +6,182 |       +96,071 |          +111,595 |
| Byreal (USDC pool, 0→1)               |   72,927 |        136,281 |  +2,585 |  +6,182 |       +95,110 |          +112,088 |
| Orca Whirlpools (SOL/USDC, A→B)       |   30,166 |         84,749 |  +3,193 |  +8,980 |       +82,752 |          +108,898 |
| Orca Whirlpools, adaptive fee (B→A)   |   42,792 |         97,130 |  +3,353 |  +9,332 |       +84,450 |           skipped |
| Cropper (SOL/USDC, B→A)               |   51,207 |        105,790 |  +3,353 |  +6,834 |       +80,955 |           +93,451 |
| DefiTuna (SOL/USDC, A→B)              |   50,589 |        109,128 |  +3,176 |  +6,657 |       +79,515 |           +91,206 |
| Crema (SOL/USDC, B→A)                 |   75,506 |        134,178 |  +2,975 |  +6,456 |       +82,758 |          +109,190 |
| Phoenix (SOL/USDC, selling base)      |   22,557 |         88,125 |  +6,437 | +14,318 |       +61,360 |                   |
| Invariant (USDC/USDT, X→Y)            |   62,133 |        119,300 |  +2,898 |  +6,379 |       +75,021 |                   |
| Manifest (SOL/USDC, selling base)     |   13,208 |         68,780 |  +4,762 |  +8,127 |       +57,206 |                   |
| OpenBook v2 (BONK/USDC, selling base) |   31,112 |         92,145 | +14,965 | +21,219 |       +85,105 |                   |

`…Data`'s few thousand units are its fields' packing and checks: the floor's 64-bit check, the
direction, one `toBytesLe`. `…Cpi` adds the program's check, building its account list into an
array, and the call. A book's data carries more: Phoenix's divides the input by its lot size, and
OpenBook's word has six fields, two of them chosen by the price. `openbookV2LotsData`, its lots
divided when the program is compiled, adds +11,070 where `openbookV2Data`, dividing, adds +14,965.
The `try` forms pay for reading the slot: the pool's owner, its state for the skips, and every
account they lay out.

Stabble CLMM runs Raydium's code and its forms cost what Raydium's do. The forms' cost does not grow
with the ticks a swap crosses; the venue's does. To the window's edge, with more input than the
window holds, Raydium CLMM's SOL/USDC swap crosses 6 ticks for 64,198 units of its own, PancakeSwap's
57 for 105,004, Crema's 1,423 for 122,377, and each form costs what it cost for ten tokens past
that.
