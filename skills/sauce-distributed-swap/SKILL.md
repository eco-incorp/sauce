---
name: sauce-distributed-swap
description: Writing a Sauce program that spreads one exact-input swap over several price-limited pools as a limit order — a limit buy that never pays more than a maximum price for any unit, fees included, and never strands input. Covers the rules a correct one follows (discover the pools, skip missing or empty ones and ones already past their limit, a fee-adjusted limit per pool, the price limit stopping each pool, a minimum and an average-price check on the total, refunding only the unspent budget), why no sorting is needed, one complete program over Uniswap V3 and Aerodrome Slipstream explained step by step, its inputs and their units, maxPrice from a human price, running it, reading a rehearsal, gas, and more venues. Use when asked for a distributed, split, multi-venue or aggregated swap, "swap across all pools", "buy up to a price", "fill up to a price limit", a limit order, or one trade routed through several pools.
---

# A distributed swap: one limit order over several pools

The caller gives **one price: the most they pay for any unit, fees included**. Every pool trades
until its own price reaches that price, and the budget it does not take stays in the Pot for the
next pool. The price does the splitting: the program never computes an amount per pool and never
sorts.

## The rules

A correct distributed swap, whatever its tokens, chain or venues:

1. **Discovers the pools** of the pair through each venue's factory, by its namespace:
   `UniswapV3.Factory.getPool(payToken, buyToken, fee)` for each fee tier,
   `AerodromeSlipstream.CLFactoryGaugesV3.getPool(payToken, buyToken, tickSpacing)` for each tick
   spacing. `0` means no pool.
2. **Skips, in the same loop, a missing pool, an empty one and one already past its limit.** A
   pool with no liquidity at its current price has nothing to sell there: its price is wherever its
   last trade left it, and a swap would spend a call to move it. A pool whose price is already at
   or past its own limit has nothing to sell within it, and handed such a limit it reverts `SPL`,
   which would revert the whole program.
3. **Gives each pool its own limit, adjusted for its fee.** A pool's price limit bounds its price,
   and its fee comes on top: under the caller's price as it is, a 0.3% pool's last unit would cost
   0.3% more. So each pool's limit is the caller's sqrt price moved toward the trade by
   `√(1 − fee)`: **`limit ÷ √(1 − fee)` paying token0, `limit × √(1 − fee)` paying token1**. The
   pool's last unit, fee paid, then costs exactly `maxPrice`, and every earlier unit less. A Uniswap
   V3 pool's fee is its tier; a Slipstream pool's is set per pool and changes, so it is read from
   the pool.
4. **Offers each pool everything still unspent** and lets the limit stop it. These pools are paid
   in their swap callback, and the Router pays exactly what the pool asks for: a pool that stops at
   its limit takes less, and the rest is still in the Pot.
5. **Checks the total**: at least `minTokens` bought, and an average no dearer than `maxAvgPrice`.
6. **Refunds only what is left of the budget**, to `refundTo`: never the Pot's whole balance of
   the token, which on an owner's Pot may hold more of it for other uses.
7. **Reads and calls through bindings and library functions, directly.** A pool's reads are its
   typed binding, `UniswapV3.Pool.at(pool).liquidity()` and `.slot0().sqrtPriceX96`
   (`AerodromeSlipstream.Pool.at(pool)` for a Slipstream pool, whose `slot0` differs); the swap is
   `uniswapV3` from `@sauce/router`; token reads and writes are the token's own. Each is written
   where it is used. A function earns its place only with logic of its own used per pool, as
   `poolLimit` and `canTrade` here; one that only wraps a call costs a call frame of gas and adds
   nothing to read.

**Why no sorting.** A pool trades only while its price, after its fee, beats `maxPrice`, so every
unit any pool sells is within it, in any order. The order decides only which pool gets the budget
when it runs out before every pool reaches its limit. With enough budget for every pool to reach
its limit, every pool's last unit costs the same, exactly `maxPrice`: the best split there is,
whatever the order.

## The program

[examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts) is one complete
implementation of those rules, over Base's Uniswap V3 and Aerodrome Slipstream pools; its header
gives every input with its units and a command for Base. Its code:

```sauce chain=base
import { uniswapV3 } from "@sauce/router";

// A pool's own limit: the caller's sqrt price moved by √(1 − fee), so that the pool's last unit,
// fee paid, costs exactly maxPrice. Paying token0 pushes the price down, token1 pushes it up.
function poolLimit(limit: Uint256, fee: Uint256, paysToken0: bool): Uint256 {
  const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // √(1 − fee), times 1e18
  if (paysToken0) {
    return Math.mulDiv(limit, 10n ** 18n, root);
  }
  return Math.mulDiv(limit, root, 10n ** 18n);
}

// Whether a pool's price is still better than its own limit.
function canTrade(price: Uint256, own: Uint256, paysToken0: bool): bool {
  if (paysToken0) {
    return price > own;
  }
  return price < own;
}

function main(
  payToken: Address,
  buyToken: Address,
  budget: Uint256,
  maxPrice: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
  refundTo: Address,
): bytes {
  const self = ctx.self();
  const pay = Token(payToken);
  require(maxPrice > 0n, "maxPrice is 0");
  require(pay.balanceOf(self) >= budget, "budget is not in the Pot");
  const kept = pay.balanceOf(self) - budget; // the Pot's other payToken, never spent
  const paysToken0 = payToken < buyToken;
  let bought = 0n;

  // maxPrice as a pool's sqrt price (token1 per token0, times 2^96): where a unit costs maxPrice.
  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1n << 192n, 10n ** 18n));
  if (paysToken0) {
    limit = Math.sqrt(Math.mulDiv(1n << 192n, 10n ** 18n, maxPrice));
  }

  // Uniswap V3: one pool per fee tier. Skip it if missing, empty or already past its own limit;
  // otherwise offer it everything unspent, and its limit stops it.
  for (const fee of [100n, 500n, 3000n, 10000n]) {
    const pool = UniswapV3.Factory.getPool(payToken, buyToken, fee);
    const unspent = pay.balanceOf(self) - kept;
    if (pool != 0n && unspent > 0n && UniswapV3.Pool.at(pool).liquidity() > 0n) {
      const own = poolLimit(limit, fee, paysToken0);
      if (canTrade(UniswapV3.Pool.at(pool).slot0().sqrtPriceX96, own, paysToken0)) {
        bought += uniswapV3(pool, payToken, buyToken, unspent, own, 0n, recipient);
      }
    }
  }

  // Aerodrome Slipstream: one pool per tick spacing, the same way. A pool's fee is its own.
  for (const spacing of [1n, 10n, 50n, 80n, 100n, 150n, 200n, 500n, 2000n]) {
    const pool = AerodromeSlipstream.CLFactoryGaugesV3.getPool(payToken, buyToken, spacing);
    const unspent = pay.balanceOf(self) - kept;
    if (pool != 0n && unspent > 0n && AerodromeSlipstream.Pool.at(pool).liquidity() > 0n) {
      const own = poolLimit(limit, AerodromeSlipstream.Pool.at(pool).fee(), paysToken0);
      if (canTrade(AerodromeSlipstream.Pool.at(pool).slot0().sqrtPriceX96, own, paysToken0)) {
        bought += uniswapV3(pool, payToken, buyToken, unspent, own, 0n, recipient);
      }
    }
  }

  // Settle: what was bought is already with the recipient; what is left of the budget goes back.
  const unspent = pay.balanceOf(self) - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0n || spent * 10n ** 18n <= maxAvgPrice * bought, "average too high");
  if (unspent > 0n) {
    pay.transfer(refundTo, unspent);
  }
  return abi.encode(spent, bought, unspent);
}
```

Step by step:

- **Inputs.** Everything that changes per trade is a `main` parameter, passed with `--args`: the
  two tokens, the budget, `maxPrice`, the two checks and the two addresses. The program names no
  token, so one file buys any token with any other.
- **The budget.** It must already be in the Pot (`sauce run --fund` pulls it in with the cook).
  `kept` is whatever else of `payToken` the Pot holds, and `unspent` is the Pot's balance less
  `kept`, so only the budget is ever offered or refunded.
- **Direction.** Token0 is the lower address of the pair, and a pool's price is token1 per token0.
  Paying token0 pushes the price down; paying token1 pushes it up. `paysToken0` picks the side at
  run time: the same program buys either way.
- **`maxPrice` as a sqrt price.** `maxPrice` is payToken per buyToken; a pool's `sqrtPriceX96` is
  the square root of token1 per token0, times 2^96. Paying token1, `limit` is
  `√(maxPrice × 2^192 ÷ 1e18)`; paying token0, the price is upside down,
  `√(2^192 × 1e18 ÷ maxPrice)`. `Math.mulDiv` keeps the full product before dividing.
- **Discover and skip.** One lookup per fee tier and per tick spacing. `pool != 0n` comes first,
  so a missing pool is never read; `unspent > 0n` stops reading once the budget is gone; a pool
  with no liquidity at its price is skipped; `canTrade` skips a pool whose price is not better than
  its own limit.
- **Each pool's limit.** `poolLimit` moves `limit` by `√(1 − fee)`, the root rounded down, so each
  limit sits a hair inside the exact one: the pool stops a little sooner, never later.
- **Swap.** `uniswapV3` swaps through the Pot's Router, exact input, with the pool's own limit and
  no floor of its own (`0n`): the totals are checked once, after both loops. A Slipstream pool
  speaks Uniswap V3's swap and callback, so the same function drives it. The output goes straight
  to `recipient`, and `uniswapV3` returns what it received.
- **Settle.** A `require` reverts the whole cook, every swap included. What is left of the budget
  goes to `refundTo`. `main` returns `abi.encode(spent, bought, unspent)`, which the cook returns
  as 96 bytes, one 32-byte word each.

**The chains it compiles on.** Each venue is a namespace contract, and naming one a chain lacks is a
compile error (`Contract 'CLFactoryGaugesV3' (aerodrome-slipstream) is not deployed on
'ethereum'`). `AerodromeSlipstream.CLFactoryGaugesV3` is on Base alone, so this program compiles for
Base. For a chain without it, write the program with the venues that chain has: Ethereum has
`UniswapV3.Factory` and no Slipstream, so the Uniswap V3 loop alone.

## Inputs and units

`main(payToken, buyToken, budget, maxPrice, minTokens, maxAvgPrice, recipient, refundTo)`, every
amount in a token's base units (its decimals are in
[../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md)): on Base, USDC has
6 decimals and WETH 18, so `1000000000` is 1,000 USDC and `1000000000000000000` is 1 WETH.

**`maxPrice`** is payToken base units per buyToken base unit, times 1e18:

`maxPrice = price × 10^(18 + payDecimals − buyDecimals)`, with `price` in whole payToken per whole
buyToken.

| Trade                                     | Price                 | `maxPrice`                      |
| ----------------------------------------- | --------------------- | ------------------------------- |
| Buy WETH with USDC                        | at most 2,713.5 USDC  | **2713500000**                  |
| Buy an 8-decimal token with USDC          | at most 150 USDC      | **1500000000000000000**         |
| Buy USDC with WETH (sell WETH at a floor) | at least 2,686.5 USDC | **372231528010422482784291829** |

The last is the same order seen from the other side: 1 WETH for at least 2,686.5 USDC is at most
`1 ÷ 2,686.5` WETH per USDC, so `10^18 × 1e18 ÷ (2,686.5 × 10^6)`, rounded down.
`maxAvgPrice` is in the same units; `0` turns it off.

**Each pool's own limit.** On Base WETH is token0 (the lower address) and USDC token1. The
program's arithmetic, back in USDC per WETH: the price at which that pool's last unit, after its
fee, costs exactly `maxPrice`.

| Fee         | Buying WETH at most 2,713.5, the pool stops at | Selling WETH at least 2,686.5, the pool stops at |
| ----------- | ---------------------------------------------- | ------------------------------------------------ |
| 100 (0.01%) | 2,713.23                                       | 2,686.77                                         |
| 500 (0.05%) | 2,712.14                                       | 2,687.84                                         |
| 3000 (0.3%) | 2,705.36                                       | 2,694.58                                         |
| 10000 (1%)  | 2,686.36                                       | 2,713.64                                         |

So buying at most 2,713.5, a 1% pool trades only while its own price is below 2,686.36: a pool
whose fee alone puts it past `maxPrice` sits out. As sqrt prices, 2,713.5 USDC per WETH is
**4127095293177970497328754** and 2,686.5 is **4106511148422261116904015**, the limits the program
derives from those two `maxPrice` values. `sauce price --chain base WETH USDC 2713.5` prints a
price's `sqrtPriceX96`, and `--sqrt-price-x96 <value>` reads a pool's back as a price.

## Getting the price right

`maxPrice` is the one number that protects the trade. Set it from the market, close to it.

- **The reference is the best price a buyer pays, fee included, among pools deep enough for the
  order.** Paying token1, a pool's price after its fee is its price divided by `1 − fee`; paying
  token0, the same upside down. Not a pool with no liquidity, whose price is stale, and not the
  deepest pool's mid price: a pool's mid sits up to its fee away from the cheap pools.
- **`maxPrice` is that reference plus the slippage you accept**, on the price itself: 0.5% above
  2,700 USDC per WETH is 2,713.5, and a WETH sold for at least 0.5% below it is 2,686.5.
- **The headroom decides which pools trade.** A `maxPrice` at or below the best price any pool
  offers trades nothing and refunds the whole budget, without reverting.
- **Too loose costs real money.** The pools fill up to whatever price they are given.

**`minTokens`, consistent with `maxPrice`.** Every unit costs `maxPrice` or less, so spending the
whole budget buys at least `budget × 1e18 ÷ maxPrice`:

- **To spend all of the budget or nothing**: `minTokens = budget × 1e18 ÷ maxPrice`, rounded up.
  Buying WETH with 3,000 USDC at most 2,713.5: `1105583195135433942`. When the pools cannot take
  all of it within `maxPrice`, the cook reverts.
- **To buy as much as fills within `maxPrice`**: `minTokens` is the least worth the gas, or `0`, and
  the rest of the budget comes back.
- **`maxAvgPrice`** caps the average whatever the fill size. At `maxPrice` itself it adds nothing
  the per-pool limits do not already guarantee; it is the check for a stricter average.

## Running it

The budget must be in the Pot before the program runs: send it there from any wallet, or let
`sauce run --fund` pull it from the signer in the same cook (`sauce-run`). Rehearse first, with no
key and nothing sent, then run. Buying WETH with up to 3,000 USDC at most 2,713.5 each, USDC pulled
in by its own permit:

```sh
npx sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --config sauce.config.json --assume-balance USDC:3000 \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x4200000000000000000000000000000000000006 \
  3000000000 2713500000 0 0 <recipient> <refundTo>
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --fund USDC:3000 --fund-mode permit \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x4200000000000000000000000000000000000006 \
  3000000000 2713500000 0 0 <recipient> <refundTo>
```

Each is one cook on the owner's Pot: `sauce tx` with the same `--args` and `--owner <address>`
prints it unsigned, `{ chainId, to, data, value }`, for any signer to send instead.

For the initial release the swap is sent only on Ethereum or Base: on a preview chain such as
Arbitrum or Optimism a program compiles and simulates, and `sauce tx` and `sauce run` refuse it
with the chain-support request to post (`sauce-chains`).

**Reading a rehearsal.** `sauce simulate` prints what `main` returned and what the cook moved.
Buying with 2,000 USDC over three pools, pool addresses as `<pool A>` to `<pool C>`:

```text
The cook succeeds from <owner>: gas used 693101, returns <96 bytes>
Token transfers:
  0.64697669175288916 WETH: <pool A> -> <Pot> (the Pot)
  1751.63668 USDC: <Pot> (the Pot) -> <pool A>
  0.64697669175288916 WETH: <Pot> (the Pot) -> <recipient>
  0.025550811867031959 WETH: <pool B> -> <Pot> (the Pot)
  69.327522 USDC: <Pot> (the Pot) -> <pool B>
  0.025550811867031959 WETH: <Pot> (the Pot) -> <recipient>
  0.066025916856648132 WETH: <pool C> -> <Pot> (the Pot)
  179.035798 USDC: <Pot> (the Pot) -> <pool C>
  0.066025916856648132 WETH: <Pot> (the Pot) -> <recipient>
Net balance changes:
  <pool A>: -0.64697669175288916 WETH, +1751.63668 USDC
  <Pot> (the Pot): -2000 USDC
  <recipient>: +0.738553420476569251 WETH
  <pool B>: -0.025550811867031959 WETH, +69.327522 USDC
  <pool C>: -0.066025916856648132 WETH, +179.035798 USDC
```

- **The 96 bytes after `returns`** are three words: `spent` (here 2,000 USDC), `bought`
  (0.738553420476569251 WETH) and `unspent` (0).
- **Each pool that traded** took payToken and gave buyToken. A pool you expected and do not see
  sat out: missing, empty, already past its limit, or the budget ran out first.
- **A partial fill** ends with one more transfer: what is left of the budget, from the Pot to
  `refundTo`.
- **The average** is `spent ÷ bought` in whole tokens (2,708.0 USDC per WETH here), to compare with
  `maxPrice` before sending.

**Gas.** Measured on a local chain against real Uniswap V3 pools: about 690,000 gas for the cook
with three pools swapped and no initialized tick crossed, and 790,000 with `--fund`'s pull.
Discovery is 13 lookups, four fee tiers and nine tick spacings; each pool found adds its reads;
every initialized tick a swap crosses adds to its swap. The gas is the same on any chain; what it
costs is the chain's gas price.

## More venues

Each venue is one more loop of the same shape: look the pool up, skip it when it is missing, empty
or past its own limit, give it its fee-adjusted limit, and offer it everything still unspent.

- **More Uniswap V3 tiers.** A factory enables tiers over time; Base's also has 200, 300 and 400.
  Add them to the list.
- **Base's other Slipstream factories**, `AerodromeSlipstream.CLFactory` and
  `AerodromeSlipstream.CLFactoryGaugeCaps`, each with pools of their own (a pair can have one at
  the same tick spacing under each, with its own fee): one more loop each, the same as the
  `CLFactoryGaugesV3` loop.
- **PancakeSwap V3**: `PancakeswapV3.Factory.getPool(a, b, fee)`, tiers 100, 500, 2500 and 10000,
  swapped with the same `uniswapV3`.
- **Uniswap V4, hookless**: a pool is a key, `{ currency0, currency1, fee, tickSpacing, hooks }`,
  with no address and no factory to ask. Its id is
  `crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n))`, and
  `UniswapV4.StateView.getLiquidity(id)` and `UniswapV4.StateView.getSlot0(id)` read it. Its fee is
  the LP fee plus any protocol fee for the direction (`getSlot0`'s `protocolFee` holds paying
  token0's in its low 12 bits and paying token1's in the next 12; the swap fee is
  `protocolFee + lpFee - protocolFee * lpFee / 1000000`). Swapped with
  `uniswapV4(UniswapV4.PoolManager, payToken, buyToken, amount, fee, tickSpacing, 0n, limit, 0n, recipient)`.
- **Not here**: pools with no price limit (V2-style pairs, Curve, Balancer, DODO, Trader Joe LB,
  WOOFi) fill in full at whatever price, and Maverick V2 bounds by tick, not by sqrt price.

## Before sending

- `maxPrice` is the best fee-inclusive price among pools with liquidity plus the slippage you
  accept, in payToken base units per buyToken base unit, times 1e18.
- `minTokens` follows the recipe: `budget × 1e18 ÷ maxPrice` to spend everything, less to accept a
  partial fill.
- A rehearsal shows the pools you expected, an average near the reference, and what came back.

[examples/distributed-swap.mts](examples/distributed-swap.mts) compiles the program for Base and
pins this page to it: the code above, the venues, `maxPrice` and the limits it gives, each pool's
own limit, `minTokens`, and the commands' arguments.
