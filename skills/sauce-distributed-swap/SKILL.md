---
name: sauce-distributed-swap
description: Writing a Sauce program that spreads one exact-input swap over several price-limited pools as a limit order — never paying past the caller's price, fees included, and never stranding input. Covers the rules a correct one follows (discover the pools, skip missing or empty ones and ones already past their limit, a fee-adjusted limit per pool, the price limit stopping each pool, a minimum output on the total, refunding only the unsold input) and why no sorting is needed, one complete program explained step by step, its inputs and their units, the limit from a human price, minOut, running it, reading a rehearsal, gas, and more venues (PancakeSwap V3, Slipstream, Uniswap V4). Use when asked for a distributed, split, multi-venue or aggregated swap, "swap across all pools", "fill up to a price limit", a limit order, or one trade routed through several pools.
---

# A distributed swap: one limit order over several pools

The caller gives **one limit: the worst price they accept, fees included**. Every pool trades
until its own price reaches that limit, and the input it does not take stays in the Pot for the
next pool. The limit does the splitting: the program never computes an amount per pool and never
sorts.

## The rules

A correct distributed swap, whatever its tokens, chain or venues:

1. **Discovers the pools** of the pair, by the chain's factory through its namespace:
   `UniswapV3.Factory.getPool(tokenIn, tokenOut, fee)` for each fee tier. `0` means no pool.
2. **Skips, in the same loop, a missing pool, an empty one and one already past its limit.** A
   pool with no liquidity at its current price has nothing to trade there: its price is wherever
   its last trade left it, and a swap would spend a call to move it. A pool whose price is already
   at or past its own limit has nothing to sell within it, and handed such a limit it reverts
   `SPL`, which would revert the whole program.
3. **Gives each pool its own limit, adjusted for its fee.** A pool's `sqrtPriceLimitX96` bounds
   its price, and its fee comes on top: under the caller's limit as it is, a 0.3% pool's last unit
   would cost 0.3% more than the limit. So each pool's limit is the caller's moved toward the
   trade by `√(1 − fee)`: **`limit ÷ √(1 − fee)` selling token0, `limit × √(1 − fee)` selling
   token1**. The pool's last unit, fee paid, then costs exactly the caller's limit, and every
   earlier unit less.
4. **Offers each pool everything still unsold** and lets the limit stop it. These pools are paid
   in their swap callback, and the Router pays exactly what the pool asks for: a pool that stops
   at its limit takes less, and the rest is still in the Pot.
5. **Checks the total** against `minOut`, and reverts below it.
6. **Refunds only what is left of `amountIn`**, to the Pot's owner: never the Pot's whole balance
   of the token, which on an owner's Pot may hold more of it for other uses.
7. **Calls bindings and library functions directly.** The factory lookup, the swap (`uniswapV3`
   from `@sauce/router`) and the token reads and writes are each one call, written where they are
   used. A function that only wraps one call adds nothing to read and costs a call frame of gas.

**Why no sorting.** A pool trades only while its price, after its fee, beats the caller's limit,
so every unit any pool sells is within the limit, in any order. The order decides only which pool
gets the input when it runs out before every pool reaches its limit. Lowest fee first spends it
where the fee is smallest. With enough input for every pool to reach its limit, every pool's last
unit costs the same, exactly the limit: the best split there is, whatever the order.

## The program

[examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts) is one complete
implementation of those rules for Uniswap V3; its header gives every input with its units and a
command for Base. Its code:

```sauce chain=base,ethereum
import { uniswapV3 } from "@sauce/router";

function main(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
) {
  const self = ctx.self();
  const input = Token(tokenIn);
  const sellsToken0 = tokenIn < tokenOut; // selling token0 pushes the price down, token1 up
  let unsold = amountIn;
  let bought = 0n;

  // Lowest fee first. Every pool stops at its own limit, so any order keeps every fill within it.
  for (const fee of [100n, 500n, 3000n, 10000n]) {
    const pool = UniswapV3.Factory.getPool(tokenIn, tokenOut, fee);
    if (unsold > 0n && pool != 0n) {
      const [inRange] = abi.decode(evm.static(pool, hex`1a686502`), ["Uint256"]); // liquidity()
      const [price] = abi.decode(evm.static(pool, hex`3850c7bd`), ["Uint256"]); // slot0()'s first word
      // A pool's limit is on its price before the fee: move it toward the trade by √(1 − fee), so
      // its last unit, fee paid, costs exactly the caller's limit.
      const root = Math.sqrt((1000000n - fee) * 1000000n); // √(1 − fee), in millionths
      const limit = sellsToken0
        ? Math.mulDiv(sqrtPriceLimitX96, 1000000n, root)
        : Math.mulDiv(sqrtPriceLimitX96, root, 1000000n);
      if (inRange > 0n && (sellsToken0 ? price > limit : price < limit)) {
        const before = input.balanceOf(self);
        bought += uniswapV3(pool, tokenIn, tokenOut, unsold, limit, 0n, recipient);
        unsold -= before - input.balanceOf(self); // the Router paid only what the pool used
      }
    }
  }

  require(bought >= minOut, "output below minOut");
  if (unsold > 0n) {
    input.transfer(ctx.msgSender(), unsold); // to the Pot's owner, who sent the cook
  }
}
```

Step by step:

- **Inputs.** Everything that changes per trade is a `main` parameter, passed with `--args`: the
  two tokens, the amount, the limit, the floor on the output and the recipient. The program names
  no chain and no token, so one file serves every pair on every chain that has the factory.
- **Direction.** Token0 is the lower address of the pair, and a pool's price is token1 per token0.
  Selling token0 pushes the price down, so the limit is a floor; selling token1 pushes it up, so
  it is a ceiling. `sellsToken0` picks the side at run time: the same program trades either way.
- **Discover.** One lookup per fee tier through `UniswapV3.Factory`, the chain's factory. A tier
  the factory does not enable, or a pair with no pool there, returns `0`.
- **Skip.** A missing pool is not read (`pool != 0n` comes first). A pool with no liquidity at its
  price (`liquidity()`) and one whose price (the first word of `slot0()`) is not better than its
  own limit are not swapped. Once nothing is left unsold, the remaining tiers are not read.
- **Each pool's limit.** `Math.sqrt` of `(1 − fee)` in millionths, rounded down, so each limit
  sits a hair inside the exact one: the pool stops a little sooner, never later.
- **Swap.** `uniswapV3` swaps through the Pot's Router, exact input, with the pool's own limit and
  no floor of its own (`0n`): the total is checked once, after the loop. The output goes straight
  to `recipient`, and `uniswapV3` returns what it received. What the pool took is the Pot's
  `tokenIn` balance before the swap minus after it.
- **Settle.** `require` reverts the whole cook, every swap included, when the total is short of
  `minOut`. What is left of `amountIn` goes back to `ctx.msgSender()`, the Pot's owner, who sent
  the cook. Any other `tokenIn` the Pot holds stays where it is.

## Inputs and units

`main(tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient)`, every amount in a
token's smallest units (its decimals are in
[../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md)): on Base, WETH has
18 decimals and USDC 6, so `1000000000000000000` is 1 WETH and `2686500000` is 2,686.5 USDC.

**The limit from a price.** `sauce price` converts a human price, quote per base, and reads no
network:

```sh
npx sauce price --chain base WETH USDC 2686.5
```

It prints the pair's order on the chain and two blocks: `sell` (WETH → USDC: the limit is a floor)
and `buy` (USDC → WETH: a ceiling). Take `sqrtPriceLimitX96` from the block of the direction you
trade. By hand: with `P` the price of one whole token0 in whole token1 and `d0`, `d1` their
decimals, `sqrtPriceX96 = floor(sqrt(P × 10^d1 / 10^d0) × 2^96)`, computed in integers as the
integer square root of `P × 10^d1 × 2^192 / 10^d0`; a price quoted the other way round is inverted
first. Back: `P = sqrtPriceX96² × 10^d0 / (2^192 × 10^d1)`.

On Base, WETH is token0 (the lower address) and USDC token1:

| Price, USDC per WETH       | `sqrtPriceLimitX96`           |
| -------------------------- | ----------------------------- |
| 2,700 (a reference)        | **4116816085950893928074568** |
| 2,686.5 (0.5% below, sell) | **4106511148422261116904015** |
| 2,713.5 (0.5% above, buy)  | **4127095293177970497328754** |

X% on the price is `√(1 ± X)` on `sqrtPriceX96`: 0.5% is × 0.99750 down or × 1.00250 up, **not**
× 0.995 or × 1.005, which would be 1%. On Ethereum USDC is token0, so the same price is a
different number there.

**Each pool's own limit**, from those two (the program's arithmetic, back in USDC per WETH): the
price at which that pool's last unit, after its fee, costs exactly the caller's.

| Fee tier    | `√(1 − fee)`, millionths | Selling WETH at 2,686.5, the pool stops at | Buying WETH at 2,713.5, the pool stops at |
| ----------- | ------------------------ | ------------------------------------------ | ----------------------------------------- |
| 100 (0.01%) | 999949                   | 2,686.77                                   | 2,713.22                                  |
| 500 (0.05%) | 999749                   | 2,687.85                                   | 2,712.14                                  |
| 3000 (0.3%) | 998498                   | 2,694.59                                   | 2,705.35                                  |
| 10000 (1%)  | 994987                   | 2,713.64                                   | 2,686.36                                  |

So selling at 2,686.5, a 1% pool trades only while its own price is above 2,713.64: a pool whose
fee alone puts it past the caller's price sits out.

## Getting the limit right

The limit is the one number that protects the trade. Set it from the market, close to it.

- **The reference is the best price a taker gets, fee included, among pools deep enough for the
  order**: a pool's price after its fee is `price × (1 − fee)` selling token0, `price ÷ (1 − fee)`
  buying it. Not a pool with no liquidity, whose price is stale, and not the deepest pool's mid
  price: a pool's mid sits up to its fee away from the cheap pools, so a 0.3% pool's price is a
  loose reference. `sauce price --chain <chain> <base> <quote> --sqrt-price-x96 <value>` reads a
  pool's `sqrtPriceX96` back as a price.
- **The limit is that reference moved by the slippage you accept**: below it when selling token0,
  above it when selling token1.
- **The headroom decides which pools trade.** A pool trades only while its price after its fee is
  better than the limit. A limit at or inside the best price any pool offers trades nothing and
  refunds everything, without reverting.
- **Too loose costs real money.** The pools fill down (or up) to whatever limit they are given; a
  limit far from the market is no limit at all.

**`minOut`, consistent with the limit.** Every unit trades at the limit or better, so a full fill
returns at least `amountIn ×` the limit's price:

- **To sell all of `amountIn` or nothing**: `minOut = amountIn × limit price`, rounded up. Selling
  1 WETH at 2,686.5: `2686500000`. Buying with 3,000 USDC at 2,713.5: `3000e6 × 1e18 / 2713.5e6`,
  rounded up, `1105583195135433942`. When the pools cannot take all of it within the limit, the
  cook reverts.
- **To sell as much as fills within the limit**: `minOut` is the least worth the gas, or `0`, and
  the rest comes back to the owner.

## Running it

The input must be in the Pot before the program runs: send it there from any wallet, or let
`sauce run --fund` pull it from the signer in the same cook (`sauce-run`). Rehearse first, with no
key and nothing sent, then run:

```sh
npx sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --config sauce.config.json --assume-balance WETH:1 \
  --args 0x4200000000000000000000000000000000000006 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  1000000000000000000 4106511148422261116904015 2686500000 <recipient>
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --fund WETH:1 \
  --args 0x4200000000000000000000000000000000000006 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  1000000000000000000 4106511148422261116904015 2686500000 <recipient>
```

Or buy WETH with up to 3,000 USDC, keeping what does not fill within the limit (`minOut` 0), with
USDC pulled in by its own permit:

```sh
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --fund USDC:3000 --fund-mode permit \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x4200000000000000000000000000000000000006 \
  3000000000 4127095293177970497328754 0 <recipient>
```

Each is one cook on the owner's Pot: `sauce tx` with the same `--args` and `--owner <address>`
prints it unsigned, `{ chainId, to, data, value }`, for any signer to send instead.

**Reading a rehearsal.** `sauce simulate` lists what the cook moved. Selling 1 WETH over two pools
it shows, pool addresses as `<pool A>` and `<pool B>`:

```text
Token transfers:
  1755.804531 USDC: <pool A> -> <Pot> (the Pot)
  0.65209225336840248 WETH: <Pot> (the Pot) -> <pool A>
  1755.804531 USDC: <Pot> (the Pot) -> <recipient>
  937.421616 USDC: <pool B> -> <Pot> (the Pot)
  0.34790774663159752 WETH: <Pot> (the Pot) -> <pool B>
  937.421616 USDC: <Pot> (the Pot) -> <recipient>
Net balance changes:
  <pool A>: -1755.804531 USDC, +0.65209225336840248 WETH
  <Pot> (the Pot): -1 WETH
  <recipient>: +2693.226147 USDC
  <pool B>: -937.421616 USDC, +0.34790774663159752 WETH
```

- **Each pool that traded** gave the output and took input: here 0.652 and 0.348 WETH. A pool you
  expected and do not see sat out: missing, empty, already past its limit, or the input ran out
  first.
- **A partial fill** ends with one more transfer, the unsold input from the Pot to the owner.
- **The average** is the output over the input the pools took (2,693.23 USDC per WETH here), to
  compare with the limit before sending.

**Gas.** Measured on a local chain against real Uniswap V3 pools: about 370,000 to 410,000 gas for
the cook with two pools swapped and no initialized tick crossed. Discovery is four lookups; each
pool found adds two reads; every initialized tick a swap crosses adds to its swap. The gas is the
same on any chain; what it costs is the chain's gas price.

## More venues

Each venue is one more loop of the same shape: look the pool up, skip it when it is missing, empty
or past its own limit, give it its fee-adjusted limit, and offer it everything still unsold.

- **More Uniswap V3 tiers.** A factory enables tiers over time; Base's also has 200, 300 and 400.
  Add them to the list. Uniswap V3's `feeAmountTickSpacing(uint24 fee)` returns a tier's tick
  spacing, `0` when the tier is not enabled.
- **PancakeSwap V3**: `PancakeswapV3.Factory.getPool(a, b, fee)`, tiers 100, 500, 2500 and 10000,
  swapped with the same `uniswapV3`.
- **Aerodrome Slipstream**: `getPool(a, b, tickSpacing)` on `AerodromeSlipstream.CLFactory` (on
  Base also `.CLFactoryGaugeCaps` and `.CLFactoryGaugesV3`), spacings 1, 10, 50, 80, 100, 150, 200,
  500 and 2000. Its fee is set per pool and changes, so read the pool's `fee()` rather than assume
  one. Swapped with `uniswapV3`.
- **Uniswap V4, hookless**: a pool is a key, `{ currency0, currency1, fee, tickSpacing, hooks }`,
  with no address and no factory to ask. Its id is
  `crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n))`, and
  `UniswapV4.StateView.getLiquidity(id)` and `UniswapV4.StateView.getSlot0(id)` read it. Its fee is
  the LP fee plus any protocol fee for the direction (`getSlot0`'s `protocolFee` holds selling
  token0's in its low 12 bits and selling token1's in the next 12; the swap fee is
  `protocolFee + lpFee - protocolFee * lpFee / 1000000`). Swapped with
  `uniswapV4(UniswapV4.PoolManager, tokenIn, tokenOut, amount, fee, tickSpacing, 0n, limit, 0n, recipient)`.
  The standard keys are 100/1, 500/10, 3000/60 and 10000/200; any other pool is found only in the
  PoolManager's `Initialize` logs.
- **A venue another chain may lack**: wrap its loop in `if (available(<Namespace.Contract>))`,
  decided when the file is compiled for a chain, so the program still compiles there.
- **Not here**: pools with no price limit (V2-style pairs, Curve, Balancer, DODO, Trader Joe LB,
  WOOFi) fill in full at whatever price, and Maverick V2 bounds by tick, not by sqrt price.

## Before sending

- The limit is the best fee-inclusive price among pools with liquidity, moved by the slippage you
  accept, on the side of the direction you trade.
- `minOut` follows the recipe: `amountIn ×` the limit's price to sell everything, less to accept a
  partial fill.
- A rehearsal shows the pools you expected, an average near the reference, and what came back.

[examples/distributed-swap.mts](examples/distributed-swap.mts) compiles the program for Base and
Ethereum and pins this page to it: the code above, the fee tiers, the per-pool limits and worked
prices, `minOut`, and the commands' arguments.
