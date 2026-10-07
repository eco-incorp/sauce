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
code. It runs on EVM chains only.

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
goes on. That holds three ways:

- `tryUniswapV2`, `tryTraderJoeLB`, `tryDodoV2` and `tryWoofi` check, before anything moves, that
  the pool takes the whole input at the floor — the V2 reserves, LB's `getSwapOut`, DODO V2's
  `querySellBase`/`querySellQuote` (priced for the Pot), WooPPV2's `tryQuery` — and otherwise run
  uncaught, so a failure the check did not foresee still reverts;
- `tryCurve` and `tryBalancerV2` catch the pool's failure and reset the approval to zero: the pool
  pulls the input and enforces the floor inside the call that is caught;
- `tryUniswapV3`, `tryUniswapV4`, `tryMaverickV2`, `tryInfinityCL` and `tryInfinityBin` catch the
  Router's call, inside which the Router pays the pool. A pool that has no code, is not the named
  pair's (V3, Maverick), or whose swap the pool or the Router refuses is skipped. What a swap that
  ran delivered is the recipient's `tokenOut` balance change (its native balance for the zero
  address); the generation-4 Router takes no floor, so it is held to `minOut` afterwards and the
  program reverts below it.

For the first two kinds a swap that ran returns at least 1, so `0` always means skipped. A Router
`try` with a `minOut` of `0` also returns `0` for a swap that ran and delivered nothing (an input the
pool rounds away); pass a positive `minOut` where `0` must mean skipped.

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
for a toolchain that resolves packages off disk. There is no SVM arm: importing `@sauce/router` for
the SVM fails at the import.
