---
name: sauce-distributed-swap
description: A Sauce program that spreads one exact-input swap over several price-limited pools on an EVM chain as a limit order, never paying more than a maximum price for any unit, fees included, and never stranding input. The rules (cover the venues that hold the pair, skip missing, empty and past-limit pools, a fee-adjusted limit per pool, minimum and average-price checks, the unspent budget sent to the recipient), one helper per pool with loops that only find pools, why no sorting is needed, a complete program buying SpaceX stock (SPCXc) with USDC over Aerodrome Slipstream, Uniswap V3 and hookless Uniswap V4 on Base, a V4 pool held by its id, priceLimit for tokens of any decimals, minTokens and maxAvgPrice, setting the price, simulating it, and the gas each lookup costs. Use when asked for a distributed, split or multi-venue swap on an EVM chain, "swap across protocols", "buy up to a price", a limit order, a minimum-amount-out or max-average-price check, or one trade routed through several pools.
---

# A distributed swap: one limit order over several pools

The caller gives **one price: the most they pay for any unit, fees included**. Every pool trades
until its own price reaches that price, and the budget it does not take stays in the Pot for the
next pool. The method, its arithmetic (`priceLimit`, `minTokens`, `maxAvgPrice`), how to set and
simulate it, and the complete program for EVM chains are here. For one swap, see `sauce-swaps`;
for the same order on Solana, on these rules, see `sauce-solana-distributed-swap`.

## When to use

| Task                                                                     | Here | Elsewhere                       |
| ------------------------------------------------------------------------ | ---- | ------------------------------- |
| Buy (or sell) up to a price across every pool of a pair, on an EVM chain | yes  |                                 |
| Work out `priceLimit`, `minTokens`, `maxAvgPrice` for any decimals       | yes  |                                 |
| One swap at one pool                                                     |      | `sauce-swaps`                   |
| The same order on Solana                                                 |      | `sauce-solana-distributed-swap` |

## Core model

- **The price does the splitting.** The program never computes an amount per pool and never sorts:
  each pool is offered everything still unspent, and its own price limit stops it.
- **Each pool's limit is adjusted for its fee**, so its last unit, fee paid, costs exactly
  `priceLimit`, and every earlier unit less.
- **Two checks on the total**: at least `minTokens` bought, an average no dearer than
  `maxAvgPrice`.
- **Only the budget moves**: what else the Pot holds of the token is never offered or sent; what the
  limits leave of the budget goes to `recipient` with what was bought.
- To see a pair's pools first (each venue's pools, fees, prices both ways, depth), run
  `sauce pools --chain <chain> <tokenA> <tokenB>`.

## The rules

A correct distributed swap, whatever its tokens, chain or venues:

1. **Covers the venues that hold the pair on the chain**, not every venue that exists. A venue's
   pools are found by namespace: `UniswapV3.Factory.getPool(a, b, fee)` per fee tier,
   `AerodromeSlipstream.CLFactoryGaugesV3.getPool(a, b, tickSpacing)` per tick spacing, and a
   hookless Uniswap V4 pool by its key, `{ currency0, currency1, fee, tickSpacing, hooks }`, read
   through `UniswapV4.StateView` by its id. `0` from a factory means no pool. Every lookup costs
   gas whether or not it finds a pool ([The token and its pools](#the-token-and-its-pools)).
2. **Skips a missing pool, an empty one and one already past its own limit.** A pool with no
   liquidity at its price has nothing to sell there; one at or past its own limit has nothing to
   sell within it, and handed such a limit reverts (`SPL` on Uniswap V3, a price-limit error on
   V4), which would revert the whole program. A V4 key with no pool reads as empty, at price 0, so
   for V4 the liquidity check is the missing-pool check too.
3. **Gives each pool its own limit, adjusted for its fee.** Under the caller's price as it is, a
   0.3% pool's last unit would cost 0.3% more. So each pool's limit is the caller's sqrt price moved
   toward the trade by `√(1 − fee)`: **`limit ÷ √(1 − fee)` paying token0, `limit × √(1 − fee)`
   paying token1**. The fee is read from the pool in the cook: a Slipstream pool's is set per pool
   and can change from one block to the next, and a V4 pool's is its LP fee plus the protocol fee
   for the direction.
4. **Offers each pool everything still unspent** and lets the limit stop it. These pools are paid in
   their swap callback, and the Router pays exactly what the pool asks for: a pool that stops at its
   limit takes less, and the rest is still in the Pot.
5. **Checks the total**: at least `minTokens` bought, and an average no dearer than `maxAvgPrice`.
6. **Sends what is left of the budget to `recipient`**, with what was bought: never the Pot's whole
   balance of the token, which on an owner's Pot may hold more of it for other uses.

**One helper per pool; the loops only find pools.** Everything a pool needs, whatever its venue, is
the same: read it, skip it or work out its limit, swap. Write that once, as one function taking the
pool and a `venue` argument saying how to read and swap it, and let each venue's loop only look
pools up and hand them over. A function earns its place only with logic of its own used more than
once; one that only wraps a call costs a call frame of gas.

- **Read a pool through its typed binding, with the pool's address**:
  `UniswapV3.Pool(pool).liquidity()`, or `AerodromeSlipstream.Pool(pool)` for a Slipstream pool,
  whose `slot0` has no `feeProtocol`; a V4 pool through the StateView, by id:
  `UniswapV4.StateView.getLiquidity(id)`. The binding and the method are one expression, never a
  value kept in a variable. Take only the outputs you need, by name (`.slot0().sqrtPriceX96`) or by
  position: `const [sqrtPriceX96, , protocolFees, poolFee] = UniswapV4.StateView.getSlot0(pool);`.
- **A function that returns a value returns it on every path**, or the program does not compile
  (`` `trade` does not return on every path ``): end every early exit with `return 0;`.

**Why no sorting.** A pool trades only while its price, after its fee, beats `priceLimit`, so every
unit any pool sells is within it, in any order. The order decides only which pool gets the budget
when it runs out before every pool reaches its limit: put the venue with the deepest, cheapest pools
first. With enough budget for every pool to reach its limit, every pool's last unit costs exactly
`priceLimit`: the best split there is, whatever the order.

## The program

[examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts) is one complete
implementation of those rules: it buys SpaceX stock on Base, SPCXc, with USDC, over Base's
Aerodrome Slipstream, Uniswap V3 and hookless Uniswap V4 pools. Its header gives every input with
its units and the command that runs it. Save it as `distributed-swap.sauce.ts` in your project:
every command below runs that file. Its code:

```sauce chain=base
import { uniswapV3, uniswapV4 } from "@sauce/router";

// One pool: skipped when missing, empty or already past its own limit, else offered all of the
// budget still unspent, up to its own limit. Returns the SPCXc it bought.
function trade(
  venue: Uint256, // 0 Uniswap V3, 1 Slipstream, 2 Uniswap V4
  pool: Uint256, // the pool's address; a V4 pool has none, and this is its id, a 256-bit hash
  spacing: Uint256, // a V4 pool's tick spacing
  kept: Uint256,
  limit: Uint256,
  recipient: Address,
): Uint256 {
  const unspent = self.USDC - kept;
  if (pool == 0 || unspent == 0) {
    return 0;
  }
  const paysToken0 = USDC < SPCXc;
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
  // costs exactly priceLimit. Paying token0 pushes the price down, token1 pushes it up.
  const root = Math.sqrt((1000000 - fee) * 10 ** 30); // √(1 − fee), times 1e18
  const own = paysToken0 ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);
  const better = paysToken0 ? price > own : price < own;
  if (liquidity == 0 || !better) {
    return 0;
  }
  if (venue == 2) {
    // A hookless pool's LP fee is its key's fee.
    const manager = UniswapV4.PoolManager;
    return uniswapV4(manager, USDC, SPCXc, unspent, lpFee, spacing, 0, own, 0, recipient);
  }
  // A Slipstream pool swaps and calls back as a Uniswap V3 pool does: uniswapV3 swaps both.
  return uniswapV3(pool, USDC, SPCXc, unspent, own, 0, recipient);
}

function main(
  budget: Uint256,
  priceLimit: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  require(priceLimit > 0, "priceLimit is 0");
  require(self.USDC >= budget, "budget is not in the Pot");
  const kept = self.USDC - budget; // the Pot's other USDC, never spent
  let bought = 0;

  // priceLimit as a pool's sqrt price (token1 per token0, times 2^96): where a unit costs it.
  let limit = Math.sqrt(Math.mulDiv(priceLimit, 1 << 192, 10 ** 18));
  if (USDC < SPCXc) {
    limit = Math.sqrt(Math.mulDiv(1 << 192, 10 ** 18, priceLimit));
  }

  // The loops only find pools; trade() decides and swaps. Slipstream, keyed by tick spacing.
  for (const spacing of [1, 10, 50, 80, 100, 150, 200, 500, 2000]) {
    const pool = AerodromeSlipstream.CLFactoryGaugesV3.getPool(USDC, SPCXc, spacing);
    bought += trade(1, pool, 0, kept, limit, recipient);
  }
  // Uniswap V3, keyed by fee tier: the seven Base's factory enables.
  for (const fee of [100, 200, 300, 400, 500, 3000, 10000]) {
    const pool = UniswapV3.Factory.getPool(USDC, SPCXc, fee);
    bought += trade(0, pool, 0, kept, limit, recipient);
  }
  // Uniswap V4, hookless, keyed by fee and tick spacing: the four standard keys. A pool is its id,
  // the hash of its key, the pair in address order: 256 bits, so a Uint256, never an Address.
  const low = USDC < SPCXc ? USDC : SPCXc;
  const high = USDC < SPCXc ? SPCXc : USDC;
  for (const key of [
    { fee: 100, spacing: 1 },
    { fee: 500, spacing: 10 },
    { fee: 3000, spacing: 60 },
    { fee: 10000, spacing: 200 },
  ]) {
    const id = crypto.keccak256(abi.encode(low, high, key.fee, key.spacing, 0));
    bought += trade(2, id, key.spacing, kept, limit, recipient);
  }

  // Settle: the recipient already has the SPCXc bought; what is left of the budget goes there too.
  const unspent = self.USDC - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  if (unspent > 0) {
    USDC.transfer(recipient, unspent);
  }
  return { spent, bought, unspent };
}
```

Step by step:

- **The tokens are written in**: `USDC` paid, `SPCXc` bought, named as the chain registers them.
  Everything that changes per trade is a `main` parameter: the budget, `priceLimit`, the two checks
  and the recipient. Another pair is those two symbols changed throughout.
- **The budget** must already be in the Pot (`sauce run --fund` pulls it in with the cook). `kept`
  is whatever else of USDC the Pot holds, so only the budget is ever offered or sent back.
- **`priceLimit` as a sqrt price.** `priceLimit` is USDC per SPCXc; a pool's `sqrtPriceX96` is the
  square root of token1 per token0 (token0 the lower address), times 2^96. Paying token1, `limit`
  is `√(priceLimit × 2^192 ÷ 1e18)`; paying token0 the price is upside down,
  `√(2^192 × 1e18 ÷ priceLimit)`. On Base USDC is token0, so the program pays token0: `USDC < SPCXc`
  is decided when it compiles. `Math.mulDiv` keeps the full product before dividing.
- **The loops** look the pair up on Slipstream's `CLFactoryGaugesV3`, one pool per tick spacing,
  then on Uniswap V3's factory, one per fee tier, then hash each of Uniswap V4's four standard
  hookless keys into a pool id, and hand each pool to `trade` with its venue: `1` Slipstream, `0`
  Uniswap V3, `2` Uniswap V4. Put first the venue `sauce pools` lists deepest for the pair; for
  USDC and SPCXc that is Slipstream.
- **`trade`** returns `0` for a missing pool or a spent budget, so a missing pool is never read. It
  reads the pool's liquidity, price and fee through its venue's binding, works out the pool's own
  limit, returns `0` for an empty pool or one not better than that limit, and otherwise swaps. The
  root is rounded down, so each limit sits a hair inside the exact one: the pool stops a little
  sooner, never later.
- **A V4 pool's fee.** `getSlot0` gives the LP fee and the protocol fees: paying token0's in the low
  12 bits, paying token1's in the next 12. The protocol fee is taken first and the LP fee from the
  rest, so the swap fee is `protocolFee + lpFee − protocolFee × lpFee ÷ 1000000`.
- **Swap.** Exact input through the Pot's Router, with the pool's own limit and no floor of its own
  (`0`): the totals are checked once, after the loops. **A Slipstream pool swaps and calls back as a
  Uniswap V3 pool does, so `uniswapV3` swaps both**; there is no separate Slipstream function. A V4
  pool swaps through `uniswapV4(UniswapV4.PoolManager, …)` with its key's fee and tick spacing; a
  hookless pool's LP fee is its key's fee. The output goes straight to `recipient`.
- **Settle.** A `require` reverts the whole cook, every swap included. The SPCXc bought is already
  with `recipient`; what is left of the budget goes there too. `main` returns `{ spent, bought, unspent }`: three words, the same 96 bytes
  `abi.encode(spent, bought, unspent)` gives, which `sauce simulate` prints by name.

**A V4 pool is its id, a `Uint256`.** A V4 pool has no address of its own: it lives in the
PoolManager, keyed by `crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))`
with the pair in address order, a 256-bit hash. Inside a program an `Address` is a 256-bit number
too, and the compiler emits the same code for either type; the id is still declared `Uint256`,
because it is not an address, and at the program's edge an `Address` is 20 bytes: `--args` refuses a
32-byte value for an `Address` parameter. A V4 pool id taken as an input or returned is a `Uint256`.

**The chains it compiles on.** Naming a venue a chain lacks is a compile error (`Contract
'CLFactoryGaugesV3' (aerodrome-slipstream) is not deployed on 'ethereum'`).
`AerodromeSlipstream.CLFactoryGaugesV3` is on Base alone, and so is SPCXc, so this program compiles
for Base. For another chain, write the loops for the venues that chain has and name its own token:
Ethereum has `UniswapV3.Factory` and `UniswapV4.StateView`, no Slipstream, and SpaceX as `SPCXon`
or `SPCXx`, so the program less its Slipstream loop, with `SPCXon` for `SPCXc`.

## The token and its pools

- **The token by its name.** `sauce globals --chain base` lists every token a program on Base can
  name, tokenized stocks included, with its address and decimals: SPCXc is Coinbase's tokenized
  SpaceX, `0xb2000000000000000000007b9fcbd005511aCBd5`, 8 decimals. The same lists are in
  [../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md) and
  [../sauce-globals/references/stocks.md](../sauce-globals/references/stocks.md). A token the
  registry does not name comes from the user or its issuer, never from a search summary, and is
  checked on chain before use (`name()`, `symbol()`, `decimals()`): decimals decide `priceLimit`.
- **The venues that hold the pair.** On Base the price-limited venues are Aerodrome Slipstream's
  three CL factories (`AerodromeSlipstream.CLFactory`, `.CLFactoryGaugeCaps`, `.CLFactoryGaugesV3`),
  Uniswap V3, PancakeSwap V3 and Uniswap V4. Which hold a pair, at which tiers, spacings and keys,
  changes over time: `sauce pools --chain base USDC SPCXc` lists every pool of the pair at each,
  with its fee, price and depth, and `--v4-key <fee:spacing>` tries a V4 key beyond the standard
  four. Write the loops for what it lists. A one-line program simulated with `sauce simulate`
  answers the same for one venue:

```sauce chain=base
// The pair's Slipstream pool at one tick spacing on one factory; 0 when there is none.
function main(a: Address, b: Address, spacing: Uint256): Address {
  return AerodromeSlipstream.CLFactoryGaugesV3.getPool(a, b, spacing);
}
```

- **Every lookup costs gas, found or not.** Measured through the engine against real Uniswap V3 and
  V4 pools, one more lookup that finds no pool costs about **18,000 gas** for a Slipstream tick
  spacing or a Uniswap V3 fee tier, and about **38,000** for a V4 key (the hash, and two StateView
  reads). The program makes 20: nine spacings, seven tiers and four keys. A venue or tier that never
  holds the pair is gas paid on every cook: drop it. One that does is depth left behind: add it
  ([More venues](#more-venues)).
- **A Slipstream fee moves** from one block to the next. The program reads it in the cook, so each
  pool's own limit is always right, but the all-in price a simulation shows can differ from a
  listing read a few blocks earlier, and the cook's from the simulation's. Simulate just before
  sending, and take the price from the simulation.

## Inputs and units

`main(budget, priceLimit, minTokens, maxAvgPrice, recipient)`, every amount in a token's base
units: on Base USDC has 6 decimals and SPCXc 8, so `1000000000` is 1,000 USDC and `666666667` is
6.66666667 SPCXc.

**`priceLimit`** is USDC base units per SPCXc base unit, times 1e18:
`priceLimit = price × 10^(18 + payDecimals − buyDecimals)`, with `price` in whole USDC per whole
SPCXc, so the price × 10^16 here. At most 150 USDC a share is **1500000000000000000**. `maxAvgPrice`
is in the same units; `0` turns it off.

**Each pool's own limit.** On Base USDC is token0 (the lower address) and SPCXc token1. The
program's arithmetic, back in USDC per SPCXc: the price at which that pool's last share, after its
fee, costs exactly `priceLimit`.

| Fee         | Buying SPCXc at most 150, the pool stops at |
| ----------- | ------------------------------------------- |
| 100 (0.01%) | 149.98                                      |
| 500 (0.05%) | 149.92                                      |
| 3000 (0.3%) | 149.55                                      |
| 10000 (1%)  | 148.50                                      |

A 1% pool trades only while its own price is below 148.50: a pool whose fee alone puts it past
`priceLimit` sits out. A V4 pool with a protocol fee stops sooner: at 0.05% with a 0.1% protocol
fee, its fee is 0.15%. As a sqrt price, 150 USDC per SPCXc is **64689523806083061751132589430**, the
limit the program derives from that `priceLimit`. `sauce price --chain base SPCXc USDC 150` prints a
price's `sqrtPriceX96`, and `--sqrt-price-x96 <value>` reads a pool's back as a price. Its `buy`
block gives that price in these units (`1500000000000000000`), as `priceLimit` and `maxAvgPrice`;
its `minAvgPrice` runs the other way round, output per input, and is never a `maxAvgPrice`.

## Setting the price and the checks

`priceLimit` is the one number that protects the trade. Set it from the market, close to it.

- **The reference is the best price a buyer pays, fee included, among pools deep enough for the
  order.** `sauce pools` prints it per pool, both ways round, and as `priceLimit` at that price.
  Paying token1, a pool's price after its fee is its price divided by `1 − fee`; paying token0, the
  same upside down. Not a pool with no liquidity, whose price is stale, and not the deepest pool's
  mid price, which sits up to its fee away from the cheap pools.
- **`priceLimit` is that reference plus the slippage you accept**, on the price itself: 1% above a
  reference of 148.5 USDC is 149.985, so 150.
- **Keep it tight.** A loose `priceLimit` reaches the thin, dear pools too, and they fill in loop
  order. A `priceLimit` at or below the best price any pool offers trades nothing and sends the
  whole budget back to `recipient`, without reverting.

**`minTokens`, consistent with `priceLimit`.** Every share costs `priceLimit` or less, so spending
the whole budget buys at least `budget × 1e18 ÷ priceLimit`:

- **To spend all of the budget or nothing**: `minTokens = budget × 1e18 ÷ priceLimit`, rounded up:
  1,000 USDC at most 150 is `666666667` (6.66666667 SPCXc). When the pools cannot take all of it
  within `priceLimit`, the cook reverts `bought below minTokens`.
- **To buy as much as fills within `priceLimit`**: `minTokens` is the least worth the gas, or `0`,
  and the rest of the budget goes to `recipient`.

**`maxAvgPrice`, from a simulation.** `priceLimit` bounds every share; `maxAvgPrice` bounds the
average, and so catches a market that moved against the order between the simulation and the cook.
Simulate with `maxAvgPrice` 0, read the average from what `main` returns (`spent × 1e18 ÷ bought`,
in `priceLimit`'s units), and set **`maxAvgPrice` halfway from that average to `priceLimit`**,
rounded up. The cook as simulated lands; one whose average moved past halfway reverts
`average too high`. A simulation averaging 148.5 USDC per SPCXc, with `priceLimit` 150, gives
149.25, **1492500000000000000**. Below the simulated average the cook reverts as it stands; at
`priceLimit` the cap adds nothing the per-pool limits do not already guarantee.

## Running it

The budget must be in the Pot before the program runs: send it there from any wallet, or let
`sauce run --fund` pull it from the signer in the same cook (`sauce-cli`). Then:

1. **Simulate the trade**, with no key and nothing sent, on the block `sauce pools` read the prices
   at (`--block <number>`, which it prints), with `maxAvgPrice` 0, to read the average.
2. **Simulate each guard's revert**: `minTokens` above what fills (reverts
   `bought below minTokens`), and `maxAvgPrice` below the average (reverts `average too high`).
3. **Send it** with `maxAvgPrice` from the rule above; `sauce run` simulates it once more before
   signing. Or print it unsigned with `sauce tx`, the same `--args` and `--owner <address>`, for any
   signer.

Buying SPCXc with 1,000 USDC at most 150 each, all of it or nothing (prices change: take the
reference from `sauce pools` when you run it):

```sh
sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:1000 --args 1000000000 1500000000000000000 666666667 0 <recipient>
sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:1000 --args 1000000000 1500000000000000000 1000000000 0 <recipient>
sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:1000 \
  --args 1000000000 1500000000000000000 666666667 1400000000000000000 <recipient>
sauce run distributed-swap.sauce.ts --chain base --keystore <keystore> \
  --fund USDC:1000 --fund-mode permit \
  --args 1000000000 1500000000000000000 666666667 1492500000000000000 <recipient>
```

The second asks for 10 SPCXc, more than 1,000 USDC buys at 150; the third caps the average at 140,
below the reference (taken here as 148.5) and so below any average; the last sends with
`maxAvgPrice` 149.25, halfway from a simulated average of 148.5 to 150. SPCXc is built into the Base
node, so simulate against Base itself, not a local copy of the chain.

**Reading a simulation.** `sauce simulate` prints what `main` returned, by name, and what the cook
moved. Buying SPCXc with 2,000 USDC at most **1507500000000000000** (150.75) over two pools on a
local chain, the addresses as placeholders and the lines on how it was simulated left out:

```text
The cook succeeds from <owner>: gas used 692591, returns <the same three words, in hex>
main returns { spent: Uint256; bought: Uint256; unspent: Uint256 }: { spent: 2000000000, bought: 1329416629, unspent: 0 }
What moved, in order:
  [1] <pool A>  -> <recipient>  3.40239687 SPCXc
  [2] Pot <Pot> -> <pool A>     512.65916 USDC
  [3] <pool B>  -> <recipient>  9.89176942 SPCXc
  [4] Pot       -> <pool B>     1487.34084 USDC
Net balance changes:
  <pool A>: -3.40239687 SPCXc, +512.65916 USDC
  <recipient>: +13.29416629 SPCXc
  <Pot> (the Pot): -2000 USDC
  <pool B>: -9.89176942 SPCXc, +1487.34084 USDC
```

- **`main returns`** names the three values: `spent` (2,000 USDC), `bought` (13.29416629 SPCXc)
  and `unspent` (0).
- **Each pool that traded** took USDC and gave SPCXc, straight to the recipient. A pool you expected
  and do not see sat out: missing, empty, already past its limit, or the budget ran out first.
- **A partial fill** ends with one more transfer: what is left of the budget, from the Pot to
  `recipient`.
- **The average** is `spent × 1e18 ÷ bought` in `priceLimit`'s units: **1504419274117564840** here,
  150.44 USDC per SPCXc. With `priceLimit` 150.75, `maxAvgPrice` halfway to it is
  **1505959637058782420**.

**Gas.** Measured on a local chain against real Uniswap V3 and V4 pools: about 661,000 for the cook
with every pool skipped, about 693,000 with two pools swapped (once the budget is spent, the pools
after are looked up but not read), and about 1,075,000 with four. Most of it is discovery, 20
lookups ([The token and its pools](#the-token-and-its-pools)); every initialized tick a swap crosses
adds to its swap.

## More venues

Each venue is one more loop that finds pools and hands them to `trade`; a venue whose pools read
differently gets its own `venue` value and branch in `trade`.

- **Base's other Slipstream factories**, `AerodromeSlipstream.CLFactory` and
  `AerodromeSlipstream.CLFactoryGaugeCaps`, each with pools of their own (Base's WETH/USDC
  Slipstream pools are on `CLFactory`, which this program does not walk); a pair can have a pool at
  the same spacing under each, with its own fee. A singleton binding takes another address too, so
  one loop walks all three:
  `for (const factory of [AerodromeSlipstream.CLFactory, AerodromeSlipstream.CLFactoryGaugeCaps, AerodromeSlipstream.CLFactoryGaugesV3])`
  and `AerodromeSlipstream.CLFactory.at(factory).getPool(a, b, spacing)`, nine lookups each.
- **PancakeSwap V3**: `PancakeswapV3.Factory.getPool(a, b, fee)`, tiers 100, 500, 2500 and 10000,
  read like a Uniswap V3 pool and swapped with the same `uniswapV3`.
- **Another hookless V4 key**: one more `{ fee, spacing }` entry, at a lookup's gas;
  `sauce pools --v4-key <fee:spacing>` shows whether the pair has a pool there.
- **Not here**: pools with no price limit (V2-style pairs, Curve, Balancer, DODO, Trader Joe LB,
  WOOFi) fill in full at whatever price; Maverick V2 bounds by tick, not by sqrt price; a V4 pool
  with hooks can take more than its key's fee.

## Pitfalls

- **`priceLimit` in whole tokens, or upside down.** It is USDC base units per SPCXc base unit, times
  1e18: `price × 10^(18 + payDecimals − buyDecimals)`, the price × 10^16 here.
- **The caller's limit handed to every pool unadjusted.** Each pool's last unit then costs its fee
  more; move each by `√(1 − fee)`.
- **`priceLimit` at or below the best price.** Nothing trades and the whole budget comes back to
  `recipient`, which is not a success: check `bought`.
- **`minTokens` inconsistent with `priceLimit`**: to spend all or nothing it is
  `budget × 1e18 ÷ priceLimit`, rounded up.
- **`maxAvgPrice` set without a simulation.** Take it halfway from a simulated average to
  `priceLimit`.
- **Sending the Pot's whole balance back.** Send only what is left of the budget.
- **Another pair by editing half of it.** The two symbols appear in every lookup and swap: change
  both everywhere, and check the new pair's token order, which decides the direction.
- **A V4 pool id as an `Address`.** It is a 256-bit `Uint256`.
- **Lookups for venues that never hold the pair.** Each costs gas on every cook; walk what
  `sauce pools` lists.

## Files

- [examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts): the program, buying
  SPCXc with USDC on Base.
- [examples/distributed-swap.mts](examples/distributed-swap.mts) compiles it for Base and pins this
  page to it: the code above, the tokens it names, the venues and lookups, a V4 pool id held as a
  `Uint256`, `priceLimit` and the limit it gives, each pool's own limit, `minTokens` and
  `maxAvgPrice`, the simulation it reads, and the commands' arguments.
