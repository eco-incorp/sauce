<!-- Generated from skills/sauce-distributed-swap/SKILL.md for the manual. Edit that file, not this one. -->

# A distributed swap: one limit order over several pools

> Say you want to buy a lot of a token, and never pay more than a set price for any of it. One pool
> alone gets dearer as you buy. A distributed swap spreads the order over several pools: each sells
> you what it can below your price, and what you have not spent moves on to the next. You name one
> price, and one transaction does the rest.

The caller gives **one price: the most they pay for any unit, fees included**. Every pool trades
until its own price reaches that price, and the budget it does not take stays in the Pot for the
next pool. The price does the splitting: the program never computes an amount per pool and never
sorts.

To see a pair's pools before a swap (each venue's pools, fees, prices both ways and depth), run
`sauce pools --chain <chain> <tokenA> <tokenB>`.

## The rules

A correct distributed swap, whatever its tokens, chain or venues:

1. **Covers the venues that hold the pair on the chain**, not every venue that exists. A venue's
   pools are found by namespace: `UniswapV3.Factory.getPool(a, b, fee)` per fee tier,
   `AerodromeSlipstream.CLFactoryGaugesV3.getPool(a, b, tickSpacing)` per tick spacing, and a
   hookless Uniswap V4 pool by its key, `{ currency0, currency1, fee, tickSpacing, hooks }`, read
   through `UniswapV4.StateView` by its id. `0` from a factory means no pool. Every lookup costs
   gas whether or not it finds a pool (see "The token and its pools").
2. **Skips a missing pool, an empty one and one already past its own limit.** A pool with no
   liquidity at its current price has nothing to sell there. A pool whose price is already at or
   past its own limit has nothing to sell within it, and handed such a limit it reverts (`SPL` on
   Uniswap V3, a price-limit error on V4), which would revert the whole program. A V4 key with no
   pool reads as empty, at price 0, so for V4 the liquidity check is the missing-pool check too.
3. **Gives each pool its own limit, adjusted for its fee.** A pool's price limit bounds its price,
   and its fee comes on top: under the caller's price as it is, a 0.3% pool's last unit would cost
   0.3% more. So each pool's limit is the caller's sqrt price moved toward the trade by
   `√(1 − fee)`: **`limit ÷ √(1 − fee)` paying token0, `limit × √(1 − fee)` paying token1**. The
   pool's last unit, fee paid, then costs exactly `maxPrice`, and every earlier unit less. The fee
   is read from the pool: a Slipstream pool's is set per pool and can change from one block to the
   next. A V4 pool's is its LP fee plus the protocol fee for the direction.
4. **Offers each pool everything still unspent** and lets the limit stop it. These pools are paid
   in their swap callback, and the Router pays exactly what the pool asks for: a pool that stops at
   its limit takes less, and the rest is still in the Pot.
5. **Checks the total**: at least `minTokens` bought, and an average no dearer than `maxAvgPrice`.
6. **Refunds only what is left of the budget**, to `refundTo`: never the Pot's whole balance of
   the token, which on an owner's Pot may hold more of it for other uses.

**One helper per pool; the loops only find pools.** Everything a pool needs, whatever its venue,
is the same: read it, skip it or work out its limit, swap. Write that once, as one function that
takes the pool and a `venue` argument saying how to read and swap it, and let each venue's loop do
nothing but look pools up and hand them over. A function earns its place only with logic of its
own used more than once; one that only wraps a call adds nothing to read and costs a call frame of
gas. Call bindings and library functions directly where they are used.

- **Read a pool through its typed binding, called with the pool's address**:
  `UniswapV3.Pool(pool).liquidity()`, or `AerodromeSlipstream.Pool(pool)` for a Slipstream pool,
  whose `slot0` has no `feeProtocol`. A V4 pool through the StateView, by id:
  `UniswapV4.StateView.getLiquidity(id)`. The binding and the method are one expression; a binding
  is not a value to keep in a variable. Take only the outputs you need, by name,
  `.slot0().sqrtPriceX96`, or by position, skipping the rest:
  `const [sqrtPriceX96, , protocolFees, poolFee] = UniswapV4.StateView.getSlot0(pool);`.
- **A function that returns a value returns it on every path**, or the program does not compile:
  `` `trade` does not return on every path ``. End every early exit with `return 0;`.

**Why no sorting.** A pool trades only while its price, after its fee, beats `maxPrice`, so every
unit any pool sells is within it, in any order. The order decides only which pool gets the budget
when it runs out before every pool reaches its limit: put the venue with the deepest, cheapest
pools first. With enough budget for every pool to reach its limit, every pool's last unit costs
the same, exactly `maxPrice`: the best split there is, whatever the order.

## The program

`distributed-swap.sauce.ts` is one complete
implementation of those rules, over Base's Aerodrome Slipstream, Uniswap V3 and hookless Uniswap V4
pools; its header gives every input with its units and two commands, one buying SPCXc and one
buying WETH, both with USDC. Its code:

```ts
// A limit buy over Base's Aerodrome Slipstream, Uniswap V3 and hookless Uniswap V4 pools: up to
// `budget` of `payToken` for `buyToken`, never more than `maxPrice` for any unit, fees included.
//
//   sauce run distributed-swap.sauce.ts --chain <chain> --keystore <keystore> \
//     --fund <payToken>:<budget> --args <payToken> <buyToken> <budget> <maxPrice> <minTokens> \
//     <maxAvgPrice> <recipient> <refundTo>
//
//   payToken: Address     the token paid; the budget must be in the Pot (`--fund` pulls it in)
//   buyToken: Address     the token bought
//   budget: Uint256       the most payToken to spend, in its base units: 1000000000 is 1,000 USDC
//   maxPrice: Uint256     the most one buyToken may cost, fees included: the price in whole tokens
//                         times 10^(18 + payDecimals − buyDecimals)
//   minTokens: Uint256    the least buyToken to receive, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in maxPrice's units; 0 turns it off
//   recipient: Address    receives what is bought
//   refundTo: Address     receives what is left of the budget
//
//   SPCXc (8 decimals) for all of 1,000 USDC (6) or nothing, at most 150 each, 149.25 on average:
//   sauce run distributed-swap.sauce.ts --chain base --keystore <keystore> --fund USDC:1000 \
//     --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
//     1000000000 1500000000000000000 666666667 1492500000000000000 <recipient> <refundTo>
//   WETH (18 decimals) for all of 3,000 USDC or nothing, at most 2,713.5 each, 2,706.75 on average:
//   sauce run distributed-swap.sauce.ts --chain base --keystore <keystore> --fund USDC:3000 \
//     --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x4200000000000000000000000000000000000006 \
//     3000000000 2713500000 1105583195135433942 2706750000 <recipient> <refundTo>
import { uniswapV3, uniswapV4 } from "@sauce/router";

// One pool: skipped when missing, empty or already past its own limit, else offered all of the
// budget still unspent, up to its own limit. Returns what it bought.
function trade(
  venue: Uint256, // 0 Uniswap V3, 1 Slipstream, 2 Uniswap V4
  pool: Uint256, // the pool's address; a V4 pool has none, and this is its id, a 256-bit hash
  spacing: Uint256, // a V4 pool's tick spacing
  payToken: Address,
  buyToken: Address,
  kept: Uint256,
  limit: Uint256,
  recipient: Address,
): Uint256 {
  const unspent = Token(payToken).balanceOf(ctx.self()) - kept;
  if (pool == 0 || unspent == 0) {
    return 0;
  }
  const paysToken0 = payToken < buyToken;
  let liquidity = 0;
  let price = 0;
  let fee = 0;
  let lpFee = 0;
  if (venue == 0) {
    liquidity = UniswapV3.Pool(pool).liquidity();
    price = UniswapV3.Pool(pool).slot0().sqrtPriceX96;
    fee = UniswapV3.Pool(pool).fee();
  } else if (venue == 1) {
    // Slipstream's own binding: its slot0 has no feeProtocol, and its fee can change any block.
    liquidity = AerodromeSlipstream.Pool(pool).liquidity();
    price = AerodromeSlipstream.Pool(pool).slot0().sqrtPriceX96;
    fee = AerodromeSlipstream.Pool(pool).fee();
  } else {
    // A missing V4 pool reads as empty. Its fee: this direction's protocol fee (paying token0's in
    // the low 12 bits, token1's in the next 12), then the LP fee on the rest.
    liquidity = UniswapV4.StateView.getLiquidity(pool);
    const [sqrtPriceX96, , protocolFees, poolFee] = UniswapV4.StateView.getSlot0(pool);
    const protocolFee = (paysToken0 ? protocolFees : protocolFees >> 12) & 0xfff;
    price = sqrtPriceX96;
    lpFee = poolFee;
    fee = protocolFee + lpFee - (protocolFee * lpFee) / 1000000;
  }
  // The pool's own limit: the caller's moved by √(1 − fee), so that its last unit, fee paid,
  // costs exactly maxPrice. Paying token0 pushes the price down, token1 pushes it up.
  const root = Math.sqrt((1000000 - fee) * 10 ** 30); // √(1 − fee), times 1e18
  const own = paysToken0 ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);
  const better = paysToken0 ? price > own : price < own;
  if (liquidity == 0 || !better) {
    return 0;
  }
  if (venue == 2) {
    // A hookless pool's LP fee is its key's fee.
    const manager = UniswapV4.PoolManager;
    return uniswapV4(manager, payToken, buyToken, unspent, lpFee, spacing, 0, own, 0, recipient);
  }
  // A Slipstream pool swaps and calls back as a Uniswap V3 pool does: uniswapV3 swaps both.
  return uniswapV3(pool, payToken, buyToken, unspent, own, 0, recipient);
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
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  const self = ctx.self();
  const pay = Token(payToken);
  require(maxPrice > 0, "maxPrice is 0");
  require(pay.balanceOf(self) >= budget, "budget is not in the Pot");
  const kept = pay.balanceOf(self) - budget; // the Pot's other payToken, never spent
  let bought = 0;

  // maxPrice as a pool's sqrt price (token1 per token0, times 2^96): where a unit costs maxPrice.
  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1 << 192, 10 ** 18));
  if (payToken < buyToken) {
    limit = Math.sqrt(Math.mulDiv(1 << 192, 10 ** 18, maxPrice));
  }

  // The loops only find pools; trade() decides and swaps. Slipstream, keyed by tick spacing.
  for (const spacing of [1, 10, 50, 80, 100, 150, 200, 500, 2000]) {
    const pool = AerodromeSlipstream.CLFactoryGaugesV3.getPool(payToken, buyToken, spacing);
    bought += trade(1, pool, 0, payToken, buyToken, kept, limit, recipient);
  }
  // Uniswap V3, keyed by fee tier: the seven Base's factory enables.
  for (const fee of [100, 200, 300, 400, 500, 3000, 10000]) {
    const pool = UniswapV3.Factory.getPool(payToken, buyToken, fee);
    bought += trade(0, pool, 0, payToken, buyToken, kept, limit, recipient);
  }
  // Uniswap V4, hookless, keyed by fee and tick spacing: the four standard keys. A pool is its id,
  // the hash of its key, the pair in address order: 256 bits, so a Uint256, never an Address.
  const low = payToken < buyToken ? payToken : buyToken;
  const high = payToken < buyToken ? buyToken : payToken;
  for (const key of [
    { fee: 100, spacing: 1 },
    { fee: 500, spacing: 10 },
    { fee: 3000, spacing: 60 },
    { fee: 10000, spacing: 200 },
  ]) {
    const id = crypto.keccak256(abi.encode(low, high, key.fee, key.spacing, 0));
    bought += trade(2, id, key.spacing, payToken, buyToken, kept, limit, recipient);
  }

  // Settle: what was bought is already with the recipient; what is left of the budget goes back.
  const unspent = pay.balanceOf(self) - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  if (unspent > 0) {
    pay.transfer(refundTo, unspent);
  }
  return { spent, bought, unspent };
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
  then on Uniswap V3's factory, one per fee tier, then hash each of Uniswap V4's four standard
  hookless keys into a pool id, and hand each pool to `trade` with its venue: `1` Slipstream, `0`
  Uniswap V3, `2` Uniswap V4. Put first the venue `sauce pools` lists deepest for the pair; this
  program puts Slipstream first.
- **`trade`** reads what is left of the budget and returns `0` for a missing pool or an empty
  budget, so a missing pool is never read. It reads the pool's liquidity, price and fee through its
  venue's binding, works out the pool's own limit, returns `0` for an empty pool or one whose
  price is not better than that limit, and otherwise swaps. Paying token0 pushes the price down;
  paying token1 pushes it up. The root is rounded down, so each limit sits a hair inside the exact
  one: the pool stops a little sooner, never later.
- **A V4 pool's fee.** `getSlot0` gives the LP fee and the protocol fees: paying token0's in the
  low 12 bits, paying token1's in the next 12. The protocol fee is taken first and the LP fee from
  the rest, so the swap fee is `protocolFee + lpFee − protocolFee × lpFee ÷ 1000000`. Composed with
  the other direction's protocol fee, the pool's last unit costs more than `maxPrice`.
- **Swap.** Exact input through the Pot's Router, with the pool's own limit and no floor of its own
  (`0`): the totals are checked once, after the loops. **A Slipstream pool swaps and calls back as
  a Uniswap V3 pool does, so `uniswapV3` swaps both**; there is no separate Slipstream function to
  call. A V4 pool swaps through `uniswapV4(UniswapV4.PoolManager, …)` with its key's fee and tick
  spacing; a hookless pool's LP fee is its key's fee. The output goes straight to `recipient`, and
  each function returns what it received.
- **Settle.** A `require` reverts the whole cook, every swap included. What is left of the budget
  goes to `refundTo`. `main` returns `{ spent, bought, unspent }`: the cook returns it as three
  words, the same 96 bytes `abi.encode(spent, bought, unspent)` gives, and `sauce simulate` prints
  it by name.

**A V4 pool is its id, a `Uint256`.** A V4 pool has no address of its own: it lives in the
PoolManager, keyed by `crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))`
with the pair in address order. That hash is 256 bits. Inside a program an `Address` is a 256-bit
number too, and the compiler emits the same code for either type, so an `Address` would not cut the
id short there; it is still declared `Uint256`, because it is not an address, and where it crosses
the program's edge an `Address` is 20 bytes: `--args` refuses a 32-byte value for an `Address`
parameter. A V4 pool id taken as an input or returned is a `Uint256`.

**The chains it compiles on.** Each venue is a namespace contract, and naming one a chain lacks is a
compile error (`Contract 'CLFactoryGaugesV3' (aerodrome-slipstream) is not deployed on
'ethereum'`). `AerodromeSlipstream.CLFactoryGaugesV3` is on Base alone, so this program compiles for
Base. For another chain, write the loops for the venues that chain has: Ethereum has
`UniswapV3.Factory` and `UniswapV4.StateView` and no Slipstream, so the program less its Slipstream
loop.

## The token and its pools

**The token by its name.** `sauce globals --chain base` lists every token a program on Base can
name, tokenized stocks included, each with its address and decimals: SPCXc is Coinbase's
tokenized SpaceX, `0xb2000000000000000000007b9fcbd005511aCBd5`, 8 decimals. The same lists are in
[tokens](../reference/tokens.md) and
[tokenized stocks](../reference/tokens.md#tokenized-stocks). A token the
registry does not name comes from the user or its issuer, never from a search summary, and is
checked on chain before use: its `name()`, `symbol()` and `decimals()`. Decimals decide
`maxPrice`.

**The venues that hold the pair.** On Base, the price-limited venues are Aerodrome Slipstream's
three CL factories (`AerodromeSlipstream.CLFactory`, `.CLFactoryGaugeCaps`, `.CLFactoryGaugesV3`),
Uniswap V3, PancakeSwap V3 and Uniswap V4. Which of them hold a pair, and at which tiers, spacings
and keys, changes over time: `sauce pools --chain base USDC SPCXc` lists every pool of the pair at
each, with its fee, price and depth, and `--v4-key <fee:spacing>` tries a V4 key beyond the
standard four. Write the loops for what it lists. A one-line program simulated with
`sauce simulate` answers the same question for one venue: it prints what `main` returns, a pool's
address (`0` for none) or its liquidity.

```ts
// The pair's Slipstream pool at one tick spacing on one factory; 0 when there is none.
function main(a: Address, b: Address, spacing: Uint256): Address {
  return AerodromeSlipstream.CLFactoryGaugesV3.getPool(a, b, spacing);
}
```

**Every lookup costs gas, found or not.** Measured through the engine against real Uniswap V3 and
V4 pools, one more lookup that finds no pool costs about **19,000 gas** for a Slipstream tick
spacing or a Uniswap V3 fee tier (one call to the factory, and the call to `trade`), and about
**42,000** for a V4 key (the hash, and two StateView reads). The program makes 20: nine spacings,
seven tiers and four keys. So a venue or a tier that never holds the pair is gas paid on every
cook: drop it. And one that does hold it is depth left behind: add it, such as Base's other
Slipstream factories (see "More venues").

**A Slipstream fee moves.** A Slipstream pool's fee is set by its fee module and can change from
one block to the next. The program reads it in the cook, so each pool's own limit is always right;
but the all-in price a simulation shows can differ from a pool listing read a few blocks earlier,
and the cook's from the simulation's. Simulate just before sending, and take the price from the
simulation, not from an older listing.

## Inputs and units

`main(payToken, buyToken, budget, maxPrice, minTokens, maxAvgPrice, recipient, refundTo)`, every
amount in a token's base units: on Base USDC has 6 decimals, WETH 18 and SPCXc 8, so `1000000000` is
1,000 USDC and `666666667` is 6.66666667 SPCXc.

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
whose fee alone puts it past `maxPrice` sits out. A V4 pool with a protocol fee stops sooner: at
0.05% with a 0.1% protocol fee, its fee is 0.15%. As sqrt prices, 2,713.5 USDC per WETH is
**4127095293177970497328754** and 2,686.5 is **4106511148422261116904015**, the limits the program
derives from those two `maxPrice` values. `sauce price --chain base WETH USDC 2713.5` prints a
price's `sqrtPriceX96`, and `--sqrt-price-x96 <value>` reads a pool's back as a price. Its `buy`
block gives that price as `maxPrice` and `maxAvgPrice` in these units (`2713500000`); its
`minAvgPrice` runs the other way round, output per input, and is never a `maxAvgPrice`.

## Getting the price right

`maxPrice` is the one number that protects the trade. Set it from the market, close to it.

- **The reference is the best price a buyer pays, fee included, among pools deep enough for the
  order.** `sauce pools` prints it for each pool, both ways round, and as `maxPrice` at that price.
  Paying token1, a pool's price after its fee is its price divided by `1 − fee`; paying token0, the
  same upside down. Not a pool with no liquidity, whose price is stale, and not the deepest pool's
  mid price: a pool's mid sits up to its fee away from the cheap pools.
- **`maxPrice` is that reference plus the slippage you accept**, on the price itself: 0.5% above
  2,700 USDC per WETH is 2,713.5, and a WETH sold for at least 0.5% below it is 2,686.5.
- **Keep it tight.** A loose `maxPrice` reaches the thin, dear pools too, and they fill in loop
  order. A `maxPrice` at or below the best price any pool offers trades nothing and refunds the
  whole budget, without reverting.

**`minTokens`, consistent with `maxPrice`.** Every unit costs `maxPrice` or less, so spending the
whole budget buys at least `budget × 1e18 ÷ maxPrice`:

- **To spend all of the budget or nothing**: `minTokens = budget × 1e18 ÷ maxPrice`, rounded up.
  Buying SPCXc with 1,000 USDC at most 150: `666666667` (6.66666667 SPCXc). Buying WETH with 3,000
  USDC at most 2,713.5: `1105583195135433942`. When the pools cannot take all of it within
  `maxPrice`, the cook reverts `bought below minTokens`.
- **To buy as much as fills within `maxPrice`**: `minTokens` is the least worth the gas, or `0`, and
  the rest of the budget comes back.

**`maxAvgPrice`, from a simulation.** `maxPrice` bounds every unit; `maxAvgPrice` bounds the
average, and so catches a market that has moved against the order between the simulation and the
cook. Simulate with `maxAvgPrice` 0, read the average from what `main` returns (`spent × 1e18 ÷
bought`, in `maxPrice`'s units), and set **`maxAvgPrice` halfway from that average to `maxPrice`**,
rounded up. The cook as simulated lands; one whose average has moved past halfway reverts
`average too high`. A simulation averaging 2,700 USDC per WETH, with `maxPrice` 2,713.5, gives
`maxAvgPrice` 2,706.75, **2706750000**; one averaging 148.5 per SPCXc, with `maxPrice` 150, gives
149.25, **1492500000000000000**. Below the simulated average the cook reverts as it stands; at
`maxPrice` the cap adds nothing the per-pool limits do not already guarantee.

## Running it

The budget must be in the Pot before the program runs: send it there from any wallet, or let
`sauce run --fund` pull it from the signer in the same cook ([the sauce command](cli.md)). **Simulate before
sending**, with no key and nothing sent, on the block `sauce pools` read the prices at
(`--block <number>`, which it prints): once with `maxAvgPrice` 0 to read the average, then once
with `minTokens` above what fills, which reverts `bought below minTokens`, and once with
`maxAvgPrice` below the average, which reverts `average too high`: that shows both checks work.
Then send it with `maxAvgPrice` from the rule above; `sauce run` simulates it once more before
signing. Buying SPCXc with 1,000 USDC at most 150 each, all of it or nothing (prices change: take
the reference from `sauce pools` when you run it):

```sh
sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:1000 \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
  1000000000 1500000000000000000 666666667 0 <recipient> <refundTo>
sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:1000 \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
  1000000000 1500000000000000000 1000000000 0 <recipient> <refundTo>
sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:1000 \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
  1000000000 1500000000000000000 666666667 1400000000000000000 <recipient> <refundTo>
sauce run distributed-swap.sauce.ts --chain base --keystore <keystore> \
  --fund USDC:1000 --fund-mode permit \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
  1000000000 1500000000000000000 666666667 1492500000000000000 <recipient> <refundTo>
```

The second asks for 10 SPCXc, more than 1,000 USDC buys at 150; the third caps the average at 140,
below the reference (taken here as 148.5) and so below any average; the last sends with
`maxAvgPrice` 149.25, halfway from a simulated average of 148.5 to 150. Each is one cook on the
owner's Pot: `sauce tx` with the same `--args` and `--owner <address>` prints it unsigned,
`{ chainId, to, data, value }`, for any signer to send instead. SPCXc is built into the Base node,
so simulate against Base itself, not a local copy of the chain.

For the initial release the swap is sent only on Ethereum or Base: on a preview chain such as
Arbitrum or Optimism a program compiles and simulates, and `sauce tx` and `sauce run` refuse it
with the chain-support request to post ([chains](../reference/chains.md)).

**Reading a simulation.** `sauce simulate` prints what `main` returned, by name, and what the cook
moved. Buying WETH with 2,000 USDC over two pools on a local chain, with the addresses as
placeholders and the lines on how it was simulated left out:

```text
The cook succeeds from <owner>: gas used 729747, returns <the same three words, in hex>
main returns { spent: Uint256; bought: Uint256; unspent: Uint256 }: { spent: 2000000000, bought: 738558490183795118, unspent: 0 }
What moved, in order:
  [1] wallet <owner> -> Pot <Pot>          … ETH                      the cook's value
  [2] Pot            -> Kitchen <Kitchen>  … ETH                      the Kitchen's fee
  [3] <pool A>       -> Pot                0.167790241413064662 WETH
  [4] Pot            -> <pool A>           455.100231 USDC
  [5] Pot            -> <recipient>        0.167790241413064662 WETH
  [6] <pool B>       -> Pot                0.570768248770730456 WETH
  [7] Pot            -> <pool B>           1544.899769 USDC
  [8] Pot            -> <recipient>        0.570768248770730456 WETH
Net balance changes:
  <pool A>: -0.167790241413064662 WETH, +455.100231 USDC
  <Pot> (the Pot): -2000 USDC
  <recipient>: +0.738558490183795118 WETH
  <pool B>: -0.570768248770730456 WETH, +1544.899769 USDC
```

- **`main returns`** names the three values: `spent` (2,000 USDC), `bought` (0.738558490183795118
  WETH) and `unspent` (0). The words after `returns` are the same three, 96 bytes.
- **Each pool that traded** took payToken and gave buyToken. A pool you expected and do not see
  sat out: missing, empty, already past its limit, or the budget ran out first.
- **A partial fill** ends with one more transfer: what is left of the budget, from the Pot to
  `refundTo`.
- **The average** is `spent × 1e18 ÷ bought` in `maxPrice`'s units: **2707977806** here, 2,707.98
  USDC per WETH. With `maxPrice` 2,713.5, `maxAvgPrice` halfway to it is **2710738903**.

**Gas.** Measured on a local chain against real Uniswap V3 and V4 pools: about 707,000 gas for the
cook with every pool skipped, about 730,000 with two pools swapped (once the budget is spent, the
pools after are looked up but not read), and about 1,134,000 with four swapped. Most of it is
discovery, 20 lookups (see "The token and its pools"); every initialized tick a swap crosses adds
to its swap. The gas is the same on any chain; what it costs is the chain's gas price.

## More venues

Each venue is one more loop that finds pools and hands them to `trade`; a venue whose pools read
differently gets its own `venue` value and branch in `trade`.

- **Base's other Slipstream factories**, `AerodromeSlipstream.CLFactory` and
  `AerodromeSlipstream.CLFactoryGaugeCaps`, each with pools of their own (Base's WETH/USDC
  Slipstream pools are on `CLFactory`, which this program does not walk). A pair can have a pool at
  the same tick spacing under each, with its own fee. A singleton binding takes another address
  too, so one loop can walk all three:
  `for (const factory of [AerodromeSlipstream.CLFactory, AerodromeSlipstream.CLFactoryGaugeCaps, AerodromeSlipstream.CLFactoryGaugesV3])`
  and `AerodromeSlipstream.CLFactory.at(factory).getPool(a, b, spacing)`, at nine lookups each.
- **PancakeSwap V3**: `PancakeswapV3.Factory.getPool(a, b, fee)`, tiers 100, 500, 2500 and 10000,
  read like a Uniswap V3 pool and swapped with the same `uniswapV3`.
- **Another hookless V4 key**: one more `{ fee, spacing }` entry in the V4 loop, at a lookup's gas;
  `sauce pools --v4-key <fee:spacing>` shows whether the pair has a pool there.
- **Not here**: pools with no price limit (V2-style pairs, Curve, Balancer, DODO, Trader Joe LB,
  WOOFi) fill in full at whatever price, and Maverick V2 bounds by tick, not by sqrt price. A V4
  pool with hooks can take more than its key's fee, and is left out.

## Before sending

- `maxPrice` is the best fee-inclusive price among pools with liquidity plus the slippage you
  accept, in payToken base units per buyToken base unit, times 1e18: `10^(18 + payDecimals −
buyDecimals)` times the price.
- `minTokens` follows the recipe: `budget × 1e18 ÷ maxPrice`, rounded up, to spend everything, less
  to accept a partial fill.
- `maxAvgPrice` is halfway from a simulation's average to `maxPrice`.
- The simulations: the trade, a `minTokens` revert and a `maxAvgPrice` revert.

`distributed-swap.mts` compiles the program for Base and
pins this page to it: the code above, the venues and the lookups, a V4 pool id held as a
`Uint256`, `maxPrice` and the limits it gives, each pool's own limit, `minTokens` and
`maxAvgPrice`, and the commands' arguments.
