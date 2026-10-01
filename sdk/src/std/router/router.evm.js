// @sauce/router — EVM arm. One function per swap venue.
//
// Every function takes RUN-TIME arguments, so a program can choose the pool, the direction and the
// amount while it executes, and every one returns the amount of `tokenOut` the recipient received.
// The arguments come in one order for every venue:
//
//   venue(pool, tokenIn, tokenOut, amountIn, <the venue's own facts>, minOut, recipient)
//
// `pool` is the contract the swap calls: the pair, the pool, the Balancer V2 Vault, the Uniswap V4
// PoolManager. `minOut` is the least the recipient may receive, and below it the whole program
// reverts; `0n` sets no floor, except for `woofi`, which requires one. `recipient` receives the
// output, and `ctx.self()` keeps it in the Pot. Every swap is EXACT INPUT: `amountIn` is what the
// Pot pays, and nothing here can express an exact-output swap.
//
// HOW EACH VENUE IS REACHED.
//
//   - Uniswap V2 (and its forks), Curve, Balancer V2, DODO V2, Trader Joe LB and WOOFi never call
//     back, so these functions call the pool itself: they push the input first (V2, DODO, LB,
//     WooPPV2) or approve exactly the input for the pool to pull (Curve, the Vault). No Router is
//     involved, so they run in any Pot.
//   - Uniswap V3 (and its forks), Uniswap V4 and Maverick V2 pools re-enter their caller mid-swap to
//     be paid. A program cannot answer that call, so these functions call the Pot's Router
//     (`ctx.self()`, whose fallback delegatecalls it), which can. The Router checks the pool's
//     tokens against `tokenIn`/`tokenOut` and pays only what the pool asks for, up to `amountIn`.
//
// Every token write is `@sauce/token`'s: OpenZeppelin `SafeERC20`, so a token that returns nothing
// (USDT) works, one that returns `false` reverts the program, and an approval resets a standing
// allowance first.
//
// NO REFUND PATH. A function that pushes its input first never catches the pool's failure: each of
// those pools spends everything it is paid or reverts (a V2 pair and a DODO V2 pool book their whole
// balance, LB reverts `LBPair__OutOfLiquidity` rather than fill part of an input, WooPPV2 books
// exactly `fromAmount`), and only an uncaught revert unwinds the push. The `try` functions are the
// one way to get a swap that may fail without reverting the program, and each loses nothing: it
// returns `0n` having moved nothing. They exist only where that can be guaranteed — `tryUniswapV2`
// and `tryTraderJoeLB` check, before anything moves, that the pool fills the whole input at the
// floor; `tryCurve` and `tryBalancerV2` catch the pool's failure and reset the approval to zero.
// DODO V2 and WOOFi have neither, so they have no `try` form.
//
// ORIENTATION is checked from the arguments while the program runs, so a direction cannot be
// stated backwards. A Uniswap V2 pair's direction IS the sort order of `tokenIn` and `tokenOut`
// (`token0` is the lower address), and so is a Uniswap V4 pool's; DODO V2 takes the pool's base and
// quote tokens and Trader Joe LB its X and Y tokens, and each reverts unless `tokenIn` and `tokenOut`
// are those two. The facts are the caller's: take them from the pool, as you take the pool itself.
//
// No module-level `const` here: a compile-time define replaces a same-named `const` in every module,
// this one included.
import { approve, balanceOf, transfer } from "@sauce/token";
import BalancerV2Vault from "./balancer-v2-vault.abi.json";
import CurveCryptoSwap from "./curve-cryptoswap.abi.json";
import CurveStableSwap from "./curve-stableswap.abi.json";
import DODOV2Pool from "./dodo-v2-pool.abi.json";
import LBPair from "./lb-pair.abi.json";
import SauceRouter from "./sauce-router.abi.json";
import UniswapV2Pair from "./uniswap-v2-pair.abi.json";
import WooPPV2 from "./woo-pp-v2.abi.json";

// ---------------------------------------------------------------------------------------------
// Uniswap V2
// ---------------------------------------------------------------------------------------------

// A Uniswap V2 pair, or a fork's. `feePpm` is the pair's LP fee in parts per million: 3000 (0.30%)
// for Uniswap V2, which `0` also means, and 2500 for PancakeSwap V2; 1_000_000 or more is refused.
// The output is priced from the pair's reserves with the Router's own constant-product math, and
// taken exactly, so the pair's K check holds for a correctly stated fee and reverts for one stated
// too low. The input is pushed first and `swap` called with empty `data` (non-empty data makes the
// pair call `uniswapV2Call` on the recipient). The pair books its whole balance, so it consumes the
// input or reverts — past `uint112`, for one.
export function uniswapV2(
  pair: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  feePpm: Uint256,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  require(feePpm < 1000000n);
  let fee = feePpm;
  if (fee == 0n) {
    fee = 3000n;
  }
  const zeroForOne = tokenIn < tokenOut;
  const [reserve0, reserve1, updated] = UniswapV2Pair.at(pair).getReserves();
  let reserveIn = reserve1;
  let reserveOut = reserve0;
  if (zeroForOne) {
    reserveIn = reserve0;
    reserveOut = reserve1;
  }
  const inWithFee = amountIn * (1000000n - fee);
  const out = Math.mulDiv(inWithFee, reserveOut, reserveIn * 1000000n + inWithFee);
  require(out >= minOut);
  transfer(tokenIn, pair, amountIn);
  let amount0Out = out;
  let amount1Out = 0n;
  if (zeroForOne) {
    amount0Out = 0n;
    amount1Out = out;
  }
  const data = hex``;
  UniswapV2Pair.at(pair).swap(amount0Out, amount1Out, recipient, data);
  return out;
}

// `uniswapV2`, or nothing: `0n` with nothing moved when the pair cannot take the whole input — no
// input, an input its reserve cannot hold (past `uint112`), or an output of zero or below the floor.
// Otherwise the swap runs uncaught, so a failure the check did not foresee still reverts.
export function tryUniswapV2(
  pair: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  feePpm: Uint256,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  require(feePpm < 1000000n);
  let fee = feePpm;
  if (fee == 0n) {
    fee = 3000n;
  }
  const zeroForOne = tokenIn < tokenOut;
  const [reserve0, reserve1, updated] = UniswapV2Pair.at(pair).getReserves();
  let reserveIn = reserve1;
  let reserveOut = reserve0;
  if (zeroForOne) {
    reserveIn = reserve0;
    reserveOut = reserve1;
  }
  // type(uint112).max: a pair's reserve refuses to grow past it. Checked before the math, which an
  // input that large would overflow.
  if (amountIn == 0n || amountIn > 5192296858534827628530496329220095n - reserveIn) {
    return 0n;
  }
  const inWithFee = amountIn * (1000000n - fee);
  const out = Math.mulDiv(inWithFee, reserveOut, reserveIn * 1000000n + inWithFee);
  if (out == 0n || out < minOut) {
    return 0n;
  }
  transfer(tokenIn, pair, amountIn);
  let amount0Out = out;
  let amount1Out = 0n;
  if (zeroForOne) {
    amount0Out = 0n;
    amount1Out = out;
  }
  const data = hex``;
  UniswapV2Pair.at(pair).swap(amount0Out, amount1Out, recipient, data);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Curve
// ---------------------------------------------------------------------------------------------

// A Curve pool's 4-argument `exchange(i, j, dx, min_dy)`, after an approval of exactly the input,
// which the pool pulls. `i`/`j` are the coins' indices; `uint256Indices` picks the CryptoSwap
// spelling (uint256 indices) over the StableSwap and StableSwap-NG one (int128), and `minOut` is
// the pool's own `min_dy`. `exchange`'s output is not decoded, because a 3pool-era pool returns none:
// what was received is the Pot's `tokenOut` balance delta, forwarded when the recipient is not the
// Pot.
export function curve(
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  i: Uint256,
  j: Uint256,
  uint256Indices: bool,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  approve(tokenIn, pool, amountIn);
  const before = balanceOf(tokenOut, ctx.self());
  if (uint256Indices) {
    CurveCryptoSwap.at(pool).exchange(i, j, amountIn, minOut);
  } else {
    CurveStableSwap.at(pool).exchange(i, j, amountIn, minOut);
  }
  const out = balanceOf(tokenOut, ctx.self()) - before;
  if (recipient != ctx.self()) {
    transfer(tokenOut, recipient, out);
  }
  return out;
}

// `curve`, or nothing: a failed `exchange` is caught, the approval reset to zero, and `0n` returned
// with nothing moved. The pool's floor is at least 1, so a swap that ran never reads as skipped.
export function tryCurve(
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  i: Uint256,
  j: Uint256,
  uint256Indices: bool,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  let floor = minOut;
  if (floor == 0n) {
    floor = 1n;
  }
  approve(tokenIn, pool, amountIn);
  const before = balanceOf(tokenOut, ctx.self());
  let failed = false;
  if (uint256Indices) {
    CurveCryptoSwap.at(pool)
      .exchange(i, j, amountIn, floor)
      .catch(() => {
        failed = true;
      });
  } else {
    CurveStableSwap.at(pool)
      .exchange(i, j, amountIn, floor)
      .catch(() => {
        failed = true;
      });
  }
  if (failed) {
    approve(tokenIn, pool, 0n);
    return 0n;
  }
  // A swap that ran delivered something: the pool's own floor is at least 1.
  const out = balanceOf(tokenOut, ctx.self()) - before;
  require(out > 0n);
  if (recipient != ctx.self()) {
    transfer(tokenOut, recipient, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Balancer V2
// ---------------------------------------------------------------------------------------------

// One Balancer V2 pool, through its Vault (`pool` is the Vault, `poolId` the pool's 32-byte id): an
// approval of exactly the input, then `Vault.swap` GIVEN_IN with `minOut` as the Vault's own limit
// and internal balances off. The Vault pays the recipient and returns the amount.
export function balancerV2(
  vault: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  poolId: Uint256,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  approve(tokenIn, vault, amountIn);
  const userData = hex``;
  // The deadline is the largest uint256: the swap runs in this transaction or not at all.
  return BalancerV2Vault.at(vault).swap(
    {
      poolId: poolId,
      kind: 0n,
      assetIn: tokenIn,
      assetOut: tokenOut,
      amount: amountIn,
      userData: userData,
    },
    {
      sender: ctx.self(),
      fromInternalBalance: false,
      recipient: recipient,
      toInternalBalance: false,
    },
    minOut,
    115792089237316195423570985008687907853269984665640564039457584007913129639935n,
  );
}

// `balancerV2`, or nothing: a failed `Vault.swap` is caught, the approval reset to zero, and `0n`
// returned with nothing moved. The Vault's limit is at least 1, so a swap that ran never reads as
// skipped.
export function tryBalancerV2(
  vault: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  poolId: Uint256,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  let floor = minOut;
  if (floor == 0n) {
    floor = 1n;
  }
  approve(tokenIn, vault, amountIn);
  const userData = hex``;
  const out = BalancerV2Vault.at(vault)
    .swap(
      {
        poolId: poolId,
        kind: 0n,
        assetIn: tokenIn,
        assetOut: tokenOut,
        amount: amountIn,
        userData: userData,
      },
      {
        sender: ctx.self(),
        fromInternalBalance: false,
        recipient: recipient,
        toInternalBalance: false,
      },
      floor,
      115792089237316195423570985008687907853269984665640564039457584007913129639935n,
    )
    .catch(() => {
      return 0n;
    });
  if (out == 0n) {
    approve(tokenIn, vault, 0n);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// DODO V2
// ---------------------------------------------------------------------------------------------

// A DODO V2 pool (DVM, DPP or DSP), given its `_BASE_TOKEN_()` and `_QUOTE_TOKEN_()`: push the input,
// then `sellBase(to)` when it is the base token or `sellQuote(to)` when it is the quote token. The
// side cannot come from address order, and the wrong one does not revert — the pool prices the
// side it was told to sell, sees none of it, and keeps the push — so this reverts unless `tokenIn`
// and `tokenOut` are the base and quote tokens, in either order. The pool books its whole balance,
// so it consumes the input or reverts.
export function dodoV2(
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  baseToken: Address,
  quoteToken: Address,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  const sellBase = tokenIn == baseToken && tokenOut == quoteToken;
  require(sellBase || (tokenIn == quoteToken && tokenOut == baseToken));
  transfer(tokenIn, pool, amountIn);
  let out = 0n;
  if (sellBase) {
    out = DODOV2Pool.at(pool).sellBase(recipient);
  } else {
    out = DODOV2Pool.at(pool).sellQuote(recipient);
  }
  require(out >= minOut);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Trader Joe Liquidity Book
// ---------------------------------------------------------------------------------------------

// A Trader Joe LB pair, given its `getTokenX()` and `getTokenY()`: push the input, then
// `swap(swapForY, to)` with `swapForY` = `tokenIn` is X. This reverts unless `tokenIn` and `tokenOut`
// are X and Y, in either order. The pair walks its bins until the whole input is spent or reverts
// `LBPair__OutOfLiquidity`, and returns both lanes packed in one word (X low, Y high); the output is
// the lane it paid. LB amounts are `uint128`.
export function traderJoeLB(
  pair: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  tokenX: Address,
  tokenY: Address,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  const swapForY = tokenIn == tokenX && tokenOut == tokenY;
  require(swapForY || (tokenIn == tokenY && tokenOut == tokenX));
  require(amountIn >> 128n == 0n);
  transfer(tokenIn, pair, amountIn);
  const packed = LBPair.at(pair).swap(swapForY, recipient);
  let out = packed & 340282366920938463463374607431768211455n;
  if (swapForY) {
    out = packed >> 128n;
  }
  require(out >= minOut);
  return out;
}

// `traderJoeLB`, or nothing: `0n` with nothing moved unless `getSwapOut` says the pair spends the
// whole input and pays at least the floor (and at least 1). Otherwise the swap runs uncaught, so a
// failure the check did not foresee still reverts.
export function tryTraderJoeLB(
  pair: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  tokenX: Address,
  tokenY: Address,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  const swapForY = tokenIn == tokenX && tokenOut == tokenY;
  require(swapForY || (tokenIn == tokenY && tokenOut == tokenX));
  if (amountIn == 0n || amountIn >> 128n != 0n) {
    return 0n;
  }
  let floor = minOut;
  if (floor == 0n) {
    floor = 1n;
  }
  const [left, quoted, fee] = LBPair.at(pair).getSwapOut(amountIn, swapForY);
  if (left != 0n || quoted < floor) {
    return 0n;
  }
  transfer(tokenIn, pair, amountIn);
  const packed = LBPair.at(pair).swap(swapForY, recipient);
  let out = packed & 340282366920938463463374607431768211455n;
  if (swapForY) {
    out = packed >> 128n;
  }
  require(out >= floor);
  return out;
}

// ---------------------------------------------------------------------------------------------
// WOOFi
// ---------------------------------------------------------------------------------------------

// WOOFi's WooPPV2 itself, not its WooRouterV2: push the input, then `swap` with `minOut` as the
// pool's own `minToAmount` and no rebate. The pool prices from an oracle, so the floor is required.
// It books exactly `fromAmount`, which is exactly the push, and reverts when its reserve, notional
// cap or oracle refuses the trade.
export function woofi(
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  require(minOut > 0n);
  transfer(tokenIn, pool, amountIn);
  return WooPPV2.at(pool).swap(tokenIn, tokenOut, amountIn, minOut, recipient, 0n);
}

// ---------------------------------------------------------------------------------------------
// Through the Pot's Router: Uniswap V3, Uniswap V4, Maverick V2
// ---------------------------------------------------------------------------------------------

// A Uniswap V3 pool, or a fork's that keeps its `swap`, through the Router's `swapV3`. A V3
// `amountSpecified` is exact input when POSITIVE, so `amountIn` must be below 2^255. A non-zero
// `sqrtPriceLimitX96` stops the swap at that price, and the Router then takes only what the pool
// used; the rest stays in the Pot. The output is the lane the pool paid, from the Router's deltas.
//
// Synthra V3 and UnitFlow V3 pools call back under their own names, which only a generation-3
// Router answers: on an older one the swap reverts.
export function uniswapV3(
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(amountIn >> 255n == 0n);
  const [amount0, amount1] = SauceRouter.at(ctx.self()).swapV3(
    pool,
    tokenIn,
    tokenOut,
    amountIn,
    sqrtPriceLimitX96,
    ctx.self(),
    recipient,
  );
  // A received lane is negative; unary `-` is two's-complement negation.
  let out = -amount0;
  if (tokenIn < tokenOut) {
    out = -amount1;
  }
  require(out >= minOut);
  return out;
}

// A Uniswap V4 pool, through the Router's `swapV4` (`pool` is the PoolManager). The pool key is
// `tokenIn` and `tokenOut` in sort order — native ETH is the zero address, which sorts first — with
// the pool's `fee`, `tickSpacing` and `hooks`, and the direction is that order. V4 reads a NEGATIVE
// `amountSpecified` as exact input, so this passes `-amountIn` (unary negation, never `0n - x`,
// which reverts), and `amountIn` must be below 2^255.
export function uniswapV4(
  poolManager: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  fee: Uint256,
  tickSpacing: Uint256,
  hooks: Address,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(tokenIn != tokenOut);
  require(amountIn >> 255n == 0n);
  const zeroForOne = tokenIn < tokenOut;
  let currency0 = tokenOut;
  let currency1 = tokenIn;
  if (zeroForOne) {
    currency0 = tokenIn;
    currency1 = tokenOut;
  }
  const [amount0, amount1] = SauceRouter.at(ctx.self()).swapV4(
    poolManager,
    {
      currency0: currency0,
      currency1: currency1,
      fee: fee,
      tickSpacing: tickSpacing,
      hooks: hooks,
    },
    zeroForOne,
    -amountIn,
    sqrtPriceLimitX96,
    ctx.self(),
    recipient,
  );
  // The lane the PoolManager paid out is positive.
  let out = amount0;
  if (zeroForOne) {
    out = amount1;
  }
  require(out >= minOut);
  return out;
}

// A Maverick V2 pool, through the Router's unified `swap` over the pool's full tick range. The
// Router pays exactly what the pool asks for, so if the pool runs out before taking all of
// `amountIn`, the rest stays in the Pot. The Router returns the input it paid and the output.
export function maverickV2(
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Address,
): Uint256 {
  require(amountIn >> 255n == 0n);
  const callback = hex``;
  const [paid, out] = SauceRouter.at(ctx.self()).swap({
    poolType: 7n,
    pool: pool,
    poolKey: { currency0: 0n, currency1: 0n, fee: 0n, tickSpacing: 0n, hooks: 0n },
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    amountSpecified: amountIn,
    sqrtPriceLimitX96: 0n,
    payer: ctx.self(),
    recipient: recipient,
    callback: callback,
  });
  require(out >= minOut);
  return out;
}
