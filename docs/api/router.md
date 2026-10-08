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
// Curve's 3pool, and keep the USDT in the Pot: each swap's recipient is `ctx.self()`, so a later
// cook spends it (pass the wallet instead to deliver it). The tokens, the factory and the pool are
// the registry's names; the amounts are only known when this runs.
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
// and the program picks the function while it runs, spending what the previous leg returned. Every
// leg pays into the Pot (`ctx.self()`), where the next leg spends it; the last leg's output stays
// there too, so a route meant for the user's wallet ends with a transfer to it.
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
leaves the rest of the input, the venues of [the distributed swap on Solana](../guides/solana-distributed-swap.md):

| Function             | Venue            | Program                                        |
| -------------------- | ---------------- | ---------------------------------------------- |
| `tryRaydiumClmm`     | Raydium CLMM     | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` |
| `tryPancakeswapClmm` | PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` |
| `tryByreal`          | Byreal           | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2`  |
| `tryStabbleClmm`     | Stabble CLMM     | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` |
| `tryOrcaWhirlpool`   | Orca Whirlpools  | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`  |
| `tryCropper`         | Cropper          | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` |
| `tryDefituna`        | DefiTuna         | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9`  |
| `tryCrema`           | Crema            | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` |
| `tryPhoenix`         | Phoenix          | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`  |

and `trySwap`, which takes a pool at any of the nine and reads its venue from the program that owns
it. Each has a plain form, `raydiumClmm` to `phoenix` and `swap`, which reverts where the `try` form
returns `0`. They all take one set of arguments and return what the recipient received:

```text
trySwap(slot: Account[], trader: Account[], amountIn, maxPrice, minOut, recipient: Account): Uint256
```

- **`slot`** is the pool's nine accounts, the System program for any the venue does not take:
  `[program, pool, config, vaultA, vaultB, extra, ticks0, ticks1, ticks2]`.
  [`sauce pools`](../guides/cli.md#sauce-pools) prints each pool's slot for the direction paid.
- **`trader`** is `[authority, source, payMint, buyMint, tokenProgram, token2022, memo]`: the
  authority that signs (the Pot, through the Kitchen), the token account paid from, the two mints,
  the SPL Token and Token-2022 programs and the memo program. Both are arrays because a function
  other than `main` keeps at most about sixteen values in use at once.
- **`amountIn`** is the most the pool may take. **`maxPrice`** is the most one unit bought may
  cost, fee included: payToken base units per buyToken base unit, times 1e18. The function reads the
  pool's fee and gives the pool its own limit, so its last unit, fee paid, costs `maxPrice`: a
  concentrated-liquidity pool's sqrt price limit moved by `√(1 − fee)`, a Phoenix order's price
  `maxPrice ÷ (1 + fee)` in ticks. The rest of `amountIn` stays in `source`.
- **`minOut`** is the least a swap that ran may deliver; below it the whole program reverts.
- **`recipient`** is the token account the output lands in; Crema and Phoenix pay only into the
  authority's own.

Each venue's function requires the slot's program to be its venue's and the pool's owner before it
reads the pool, because the authority signs the swap; `trySwap` requires the slot's program to own
the pool and that owner to be one of the nine. These are the caller's accounts, so each reverts
rather than skips: a slot naming another program, a pool of another venue (`not a Crema pool`, …)
or of none (`not a supported venue's pool`), and a pool that is not the pair. Only the System
program itself as the pool is a missing slot, which a `try` form skips.

A failed call into another program fails the whole Solana transaction and cannot be caught, so a
`try` form checks before anything moves and returns `0`, having moved nothing, for a missing slot
(the System program as its pool), no input, a pool whose swaps are off, a paused pool or a market
not open for taking, a fee that is more than one rate (a dynamic or adaptive fee, or a Byreal
pool's own), a pool with no liquidity at its price, a pool already past its own limit, an input too
small to buy one unit at the pool's price after its fee, an input smaller than one of a market's
lots, and a market limit too large for an order's 64-bit price. The price only worsens as a pool
sells, so the estimate is the most the input could buy: dust an earlier pool left (an atom, which
the fee takes whole) is skipped, never handed to a venue that would keep it or refuse it. A Phoenix
order whose book has no offer within the limit is placed and fills nothing, so it returns `0` too,
nothing having moved. A swap that ran returns at least 1, held to `minOut` and at least 1, and
reverts below it. A failure the checks do not foresee, such as a tick array missing from the slot,
fails the transaction.

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

A program carries the venues it calls and no other: one venue's function is about 1.7 KB of
program, `trySwap` all nine about 4.4 KB. A program that knows its venue calls that venue's
function, and keeps `trySwap` for slots whose venue it learns as it runs. Either is past one
transaction, so the program is staged in a code buffer, as `sauce run` does. [The distributed swap on Solana](../guides/solana-distributed-swap.md)
is one `trySwap` call per pool.
