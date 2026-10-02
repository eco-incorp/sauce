---
name: sauce-distributed-swap
description: Writing a Sauce program that spreads one exact-input swap over several price-limited pools as a limit order, a limit buy that never pays more than a maximum price for any unit, fees included, and never strands input. Covers the rules (cover the venues that hold the pair, skip missing, empty and past-limit pools, a fee-adjusted limit per pool, minimum and average-price checks, refund only the unspent budget), one helper per pool with loops that only find pools, why no sorting is needed, a complete program over Aerodrome Slipstream and Uniswap V3 on Base, maxPrice for tokens of any decimals (an 8-decimal tokenized stock such as SPCXc), finding a token and its pools, the three rehearsals before sending, and more venues. Use when asked for a distributed, split or multi-venue swap, "swap across protocols", "buy up to a price", a limit order, a minimum-amount-out or max-average-price check, or one trade routed through several pools.
---

# A distributed swap: one limit order over several pools

The caller gives **one price: the most they pay for any unit, fees included**. Every pool trades
until its own price reaches that price, and the budget it does not take stays in the Pot for the
next pool. The price does the splitting: the program never computes an amount per pool and never
sorts.

## The rules

A correct distributed swap, whatever its tokens, chain or venues:

1. **Covers the venues that hold the pair on the chain**, not every venue that exists. A venue's
   pools are found through its factory, by namespace: `UniswapV3.Factory.getPool(a, b, fee)` per
   fee tier, `AerodromeSlipstream.CLFactoryGaugesV3.getPool(a, b, tickSpacing)` per tick spacing.
   `0` means no pool.
2. **Skips a missing pool, an empty one and one already past its own limit.** A pool with no
   liquidity at its current price has nothing to sell there. A pool whose price is already at or
   past its own limit has nothing to sell within it, and handed such a limit it reverts `SPL`,
   which would revert the whole program.
3. **Gives each pool its own limit, adjusted for its fee.** A pool's price limit bounds its price,
   and its fee comes on top: under the caller's price as it is, a 0.3% pool's last unit would cost
   0.3% more. So each pool's limit is the caller's sqrt price moved toward the trade by
   `√(1 − fee)`: **`limit ÷ √(1 − fee)` paying token0, `limit × √(1 − fee)` paying token1**. The
   pool's last unit, fee paid, then costs exactly `maxPrice`, and every earlier unit less. The fee
   is read from the pool: a Slipstream pool's is set per pool and changes over time.
4. **Offers each pool everything still unspent** and lets the limit stop it. These pools are paid
   in their swap callback, and the Router pays exactly what the pool asks for: a pool that stops at
   its limit takes less, and the rest is still in the Pot.
5. **Checks the total**: at least `minTokens` bought, and an average no dearer than `maxAvgPrice`.
6. **Refunds only what is left of the budget**, to `refundTo`: never the Pot's whole balance of
   the token, which on an owner's Pot may hold more of it for other uses.

**One helper per pool; the loops only find pools.** Everything a pool needs, whatever its venue,
is the same: read it, skip it or work out its limit, swap. Write that once, as one function that
takes the pool, and let each venue's loop do nothing but look pools up and hand them over. A
function earns its place only with logic of its own used more than once; one that only wraps a
call adds nothing to read and costs a call frame of gas. Call bindings and library functions
directly where they are used.

- **Read a pool through its typed binding**: `UniswapV3.Pool.at(pool).liquidity()`, or
  `AerodromeSlipstream.Pool.at(pool)` for a Slipstream pool, whose `slot0` has no `feeProtocol`.
  `.at(...)` and the call are one expression; a binding is not a value to keep in a variable.
  Take only the output you need, by name, `.slot0().sqrtPriceX96`, or by position,
  `const [sqrtPriceX96] = UniswapV3.Pool.at(pool).slot0();`, never all of them.
- **A function that returns a value returns it on every path**, or the program does not compile:
  `` `trade` does not return on every path ``. End every early exit with `return 0n;`.

**Why no sorting.** A pool trades only while its price, after its fee, beats `maxPrice`, so every
unit any pool sells is within it, in any order. The order decides only which pool gets the budget
when it runs out before every pool reaches its limit: put the venue with the deepest, cheapest
pools first. With enough budget for every pool to reach its limit, every pool's last unit costs
the same, exactly `maxPrice`: the best split there is, whatever the order.

## The program

[examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts) is one complete
implementation of those rules, over Base's Aerodrome Slipstream and Uniswap V3 pools; its header
gives every input with its units and a command that buys SPCXc with USDC. Its code:

```sauce chain=base
import { uniswapV3 } from "@sauce/router";

// One pool, from either venue: skipped when missing, empty or already past its own limit, else
// offered all of the budget still unspent, up to its own limit. Returns what it bought.
// `slipstream` picks the pool's ABI: a Slipstream pool's slot0 has no feeProtocol.
function trade(
  pool: Address,
  slipstream: bool,
  payToken: Address,
  buyToken: Address,
  kept: Uint256,
  limit: Uint256,
  recipient: Address,
): Uint256 {
  const unspent = Token(payToken).balanceOf(ctx.self()) - kept;
  if (pool == 0n || unspent == 0n) {
    return 0n;
  }
  let liquidity = 0n;
  let price = 0n;
  let fee = 0n;
  if (slipstream) {
    liquidity = AerodromeSlipstream.Pool.at(pool).liquidity();
    price = AerodromeSlipstream.Pool.at(pool).slot0().sqrtPriceX96;
    fee = AerodromeSlipstream.Pool.at(pool).fee();
  } else {
    liquidity = UniswapV3.Pool.at(pool).liquidity();
    price = UniswapV3.Pool.at(pool).slot0().sqrtPriceX96;
    fee = UniswapV3.Pool.at(pool).fee();
  }
  // The pool's own limit: the caller's moved by √(1 − fee), so that its last unit, fee paid,
  // costs exactly maxPrice. Paying token0 pushes the price down, token1 pushes it up.
  const paysToken0 = payToken < buyToken;
  const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // √(1 − fee), times 1e18
  const own = paysToken0
    ? Math.mulDiv(limit, 10n ** 18n, root)
    : Math.mulDiv(limit, root, 10n ** 18n);
  const better = paysToken0 ? price > own : price < own;
  if (liquidity == 0n || !better) {
    return 0n;
  }
  return uniswapV3(pool, payToken, buyToken, unspent, own, 0n, recipient);
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
  let bought = 0n;

  // maxPrice as a pool's sqrt price (token1 per token0, times 2^96): where a unit costs maxPrice.
  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1n << 192n, 10n ** 18n));
  if (payToken < buyToken) {
    limit = Math.sqrt(Math.mulDiv(1n << 192n, 10n ** 18n, maxPrice));
  }

  // The loops only find pools; trade() decides and swaps. Slipstream, keyed by tick spacing.
  for (const spacing of [1n, 10n, 50n, 80n, 100n, 150n, 200n, 500n, 2000n]) {
    const pool = AerodromeSlipstream.CLFactoryGaugesV3.getPool(payToken, buyToken, spacing);
    bought += trade(pool, true, payToken, buyToken, kept, limit, recipient);
  }
  // Uniswap V3, keyed by fee tier: the seven Base's factory enables.
  for (const fee of [100n, 200n, 300n, 400n, 500n, 3000n, 10000n]) {
    const pool = UniswapV3.Factory.getPool(payToken, buyToken, fee);
    bought += trade(pool, false, payToken, buyToken, kept, limit, recipient);
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
  `kept` is whatever else of `payToken` the Pot holds, so only the budget is ever offered or
  refunded.
- **`maxPrice` as a sqrt price.** `maxPrice` is payToken per buyToken; a pool's `sqrtPriceX96` is
  the square root of token1 per token0 (token0 is the lower address), times 2^96. Paying token1,
  `limit` is `√(maxPrice × 2^192 ÷ 1e18)`; paying token0, the price is upside down,
  `√(2^192 × 1e18 ÷ maxPrice)`. `Math.mulDiv` keeps the full product before dividing.
- **The loops** look the pair up on Slipstream's `CLFactoryGaugesV3`, one pool per tick spacing,
  then on Uniswap V3's factory, one per fee tier, and hand each pool to `trade`. Slipstream comes
  first: for the pair this program is written for, its pool is the deep one.
- **`trade`** reads what is left of the budget and returns `0n` for a missing pool or an empty
  budget, so a missing pool is never read. It reads the pool's liquidity, price and fee through the
  venue's binding (`slipstream` says which), works out the pool's own limit, returns `0n` for an
  empty pool or one whose price is not better than that limit, and otherwise swaps. Paying token0
  pushes the price down; paying token1 pushes it up. The root is rounded down, so each limit sits a
  hair inside the exact one: the pool stops a little sooner, never later.
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
Base. For another chain, write the loops for the venues that chain has: Ethereum has
`UniswapV3.Factory` and no Slipstream, so the Uniswap V3 loop alone.

## The token and its pools

**The token by its name.** `npx sauce globals --chain base` lists every token a program on Base can
name, tokenized stocks included, each with its address and decimals: SPCXc is Coinbase's
tokenized SpaceX, `0xb2000000000000000000007b9fcbd005511aCBd5`, 8 decimals. The same lists are in
[../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md) and
[../sauce-globals/references/stocks.md](../sauce-globals/references/stocks.md). A token the
registry does not name comes from the user or its issuer, never from a search summary, and is
checked on chain before use: its `name()`, `symbol()` and `decimals()`. Decimals decide
`maxPrice`.

**The venues that hold the pair.** On Base, the price-limited venues are Aerodrome Slipstream's
three CL factories (`AerodromeSlipstream.CLFactory`, `.CLFactoryGaugeCaps`, `.CLFactoryGaugesV3`),
Uniswap V3, PancakeSwap V3 and Uniswap V4. Look the pair up before writing the loops: a one-line
program rehearsed with `sauce simulate` prints what `main` returns, a pool's address (`0` for none)
or its liquidity.

```sauce chain=base
// The pair's Slipstream pool at one tick spacing on one factory; 0 when there is none.
function main(a: Address, b: Address, spacing: Uint256): Address {
  return AerodromeSlipstream.CLFactoryGaugesV3.getPool(a, b, spacing);
}
```

Read on chain on 2026-10-01: SPCXc against USDC had its deep pool on `CLFactoryGaugesV3` at tick
spacing 10 (fee 0.05%) and a Uniswap V3 pool at 1%, which is why the program covers those two
venues.

## Inputs and units

`main(payToken, buyToken, budget, maxPrice, minTokens, maxAvgPrice, recipient, refundTo)`, every
amount in a token's base units: on Base USDC has 6 decimals, WETH 18 and SPCXc 8, so `1000000000` is
1,000 USDC and `660000000` is 6.6 SPCXc.

**`maxPrice`** is payToken base units per buyToken base unit, times 1e18:

`maxPrice = price × 10^(18 + payDecimals − buyDecimals)`, with `price` in whole payToken per whole
buyToken. Paying USDC (6), that is the price × 10^16 for SPCXc (8) and × 10^6 for WETH (18).

| Trade                                     | Price                 | `maxPrice`                      |
| ----------------------------------------- | --------------------- | ------------------------------- |
| Buy SPCXc with USDC                       | at most 150 USDC      | **1500000000000000000**         |
| Buy WETH with USDC                        | at most 2,713.5 USDC  | **2713500000**                  |
| Buy USDC with WETH (sell WETH at a floor) | at least 2,686.5 USDC | **372231528010422482784291829** |

The last is the same order seen from the other side: 1 WETH for at least 2,686.5 USDC is at most
`1 ÷ 2,686.5` WETH per USDC, so `10^18 × 1e18 ÷ (2,686.5 × 10^6)`, rounded down. `maxAvgPrice` is
in the same units; `0` turns it off.

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
- **Keep it tight.** A loose `maxPrice` reaches the thin, dear pools too, and they fill in loop
  order. A `maxPrice` at or below the best price any pool offers trades nothing and refunds the
  whole budget, without reverting.

**`minTokens`, consistent with `maxPrice`.** Every unit costs `maxPrice` or less, so spending the
whole budget buys at least `budget × 1e18 ÷ maxPrice`:

- **To spend all of the budget or nothing**: `minTokens = budget × 1e18 ÷ maxPrice`, rounded up.
  Buying WETH with 3,000 USDC at most 2,713.5: `1105583195135433942`. When the pools cannot take
  all of it within `maxPrice`, the cook reverts.
- **To buy as much as fills within `maxPrice`**: `minTokens` is the least worth the gas, or `0`, and
  the rest of the budget comes back.
- **`maxAvgPrice`** caps the average whatever the fill size: set it between the reference and
  `maxPrice`. At `maxPrice` itself it adds nothing the per-pool limits do not already guarantee.

## Running it

The budget must be in the Pot before the program runs: send it there from any wallet, or let
`sauce run --fund` pull it from the signer in the same cook (`sauce-run`). **Rehearse three times
before sending**, with no key and nothing sent: the trade as meant, one with `minTokens` above what
fills, which reverts `bought below minTokens`, and one with `maxAvgPrice` below the average, which
reverts `average too high`. That shows both checks work. Buying SPCXc with 1,000 USDC at most 150
each, with the price near 148.8 on 2026-10-01:

```sh
npx sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --config sauce.config.json --assume-balance USDC:1000 \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
  1000000000 1500000000000000000 660000000 1495000000000000000 <recipient> <refundTo>
npx sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --config sauce.config.json --assume-balance USDC:1000 \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
  1000000000 1500000000000000000 1000000000 1495000000000000000 <recipient> <refundTo>
npx sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --config sauce.config.json --assume-balance USDC:1000 \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
  1000000000 1500000000000000000 660000000 1400000000000000000 <recipient> <refundTo>
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --fund USDC:1000 --fund-mode permit \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
  1000000000 1500000000000000000 660000000 1495000000000000000 <recipient> <refundTo>
```

The second asks for 10 SPCXc, more than 1,000 USDC buys at 150; the third caps the average at 140,
below the market. Each is one cook on the owner's Pot: `sauce tx` with the same `--args` and
`--owner <address>` prints it unsigned, `{ chainId, to, data, value }`, for any signer to send
instead. SPCXc is built into the Base node, so rehearse against Base itself, not a local copy of
the chain.

For the initial release the swap is sent only on Ethereum or Base: on a preview chain such as
Arbitrum or Optimism a program compiles and simulates, and `sauce tx` and `sauce run` refuse it
with the chain-support request to post (`sauce-chains`).

**Reading a rehearsal.** `sauce simulate` prints what `main` returned and what the cook moved.
Buying WETH with 2,000 USDC over two pools, pool addresses as `<pool A>` and `<pool B>`:

```text
The cook succeeds from <owner>: gas used 642327, returns <96 bytes>
Token transfers:
  0.167790241413064662 WETH: <pool A> -> <Pot> (the Pot)
  455.100231 USDC: <Pot> (the Pot) -> <pool A>
  0.167790241413064662 WETH: <Pot> (the Pot) -> <recipient>
  0.570768248770730456 WETH: <pool B> -> <Pot> (the Pot)
  1544.899769 USDC: <Pot> (the Pot) -> <pool B>
  0.570768248770730456 WETH: <Pot> (the Pot) -> <recipient>
Net balance changes:
  <pool A>: -0.167790241413064662 WETH, +455.100231 USDC
  <Pot> (the Pot): -2000 USDC
  <recipient>: +0.738558490183795118 WETH
  <pool B>: -0.570768248770730456 WETH, +1544.899769 USDC
```

- **The 96 bytes after `returns`** are three words: `spent` (here 2,000 USDC), `bought`
  (0.738558490183795118 WETH) and `unspent` (0).
- **Each pool that traded** took payToken and gave buyToken. A pool you expected and do not see
  sat out: missing, empty, already past its limit, or the budget ran out first.
- **A partial fill** ends with one more transfer: what is left of the budget, from the Pot to
  `refundTo`.
- **The average** is `spent ÷ bought` in whole tokens (2,708.0 USDC per WETH here), to compare with
  `maxPrice` before sending.

**Gas.** Measured on a local chain against real Uniswap V3 pools: about 640,000 gas for the cook with
two pools swapped and no initialized tick crossed. Discovery is 16 lookups, nine tick spacings and
seven fee tiers; each pool found adds its reads; every initialized tick a swap crosses adds to its
swap. The gas is the same on any chain; what it costs is the chain's gas price.

## More venues

Each venue is one more loop that finds pools and hands them to `trade`; a venue whose pools read
differently gets its branch in `trade`.

- **Base's other Slipstream factories**, `AerodromeSlipstream.CLFactory` and
  `AerodromeSlipstream.CLFactoryGaugeCaps`, each with pools of their own (Base's WETH/USDC
  Slipstream pools are on `CLFactory`). A pair can have a pool at the same tick spacing under each,
  with its own fee. A singleton binding takes another address too, so one loop can walk all three:
  `for (const factory of [AerodromeSlipstream.CLFactory, AerodromeSlipstream.CLFactoryGaugeCaps, AerodromeSlipstream.CLFactoryGaugesV3])`
  and `AerodromeSlipstream.CLFactory.at(factory).getPool(a, b, spacing)`.
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
  accept, in payToken base units per buyToken base unit, times 1e18: `10^(18 + payDecimals −
buyDecimals)` times the price.
- `minTokens` follows the recipe: `budget × 1e18 ÷ maxPrice` to spend everything, less to accept a
  partial fill.
- Three rehearsals: the trade, a `minTokens` revert and a `maxAvgPrice` revert.

[examples/distributed-swap.mts](examples/distributed-swap.mts) compiles the program for Base and
pins this page to it: the code above, the venues, `maxPrice` and the limits it gives, each pool's
own limit, `minTokens`, and the commands' arguments.
