---
name: sauce-distributed-swap
description: Writing a Sauce program that distributes one exact-input swap across every price-limited pool on a chain (Uniswap V3, PancakeSwap V3, Aerodrome Slipstream, hookless Uniswap V4), never paying past the caller's price and never stranding input. Covers the venues it covers and why, Uniswap V4 keys as an input, skipping pools with no liquidity before their price, each pool's fee (V4 protocol fee included), a fee-adjusted limit per pool, ranking by the price a taker gets, one swap per pool with the leftover flowing on, setting the limit from the best taker price, minimum output and average-price checks, refunding only what is left of the amount, returning the outcome, reading a rehearsal, gas, and sqrtPriceX96 conversions. Use when asked for a distributed, split, multi-venue, aggregated or best-execution swap, "swap across all protocols", "fill up to a price limit", a limit-order-like swap, or routing one trade through several pools.
---

# A distributed swap across price-limit venues

The reference program is
[examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts). It names no chain, so one
file compiles for every chain, with the venues that chain has;
[examples/distributed-swap.mts](examples/distributed-swap.mts) compiles it for Base, Arbitrum and
Ethereum with every venue those chains have and builds the cook with its inputs. Start from it; this
skill explains its design and gives every value a run on Base needs. The same swap as the body of a
cross-chain intent, paid for on another chain, is
[../sauce-intents/examples/swap-on-base.sauce.ts](../sauce-intents/examples/swap-on-base.sauce.ts).

## The design

The caller gives **one limit: the worst marginal price they accept, fees included**. The limit does
the splitting; the program never computes amounts per pool.

1. **Discover** the pair's pools on every price-limit venue the chain has: V3-style pools through
   their factories, hookless Uniswap V4 pools by the keys passed in.
2. **Skip every pool with no liquidity at its current price**, before looking at its price: an
   empty pool's price is stale, wherever its last trade left it, and would rank first.
3. **Read each pool's fee**: the tier, Slipstream's live fee, V4's LP fee plus its protocol fee.
4. **Give each pool its own limit**, so that its last unit costs exactly the caller's limit
   including its fee, and keep the pools priced better than it.
5. **Rank** them by the price a taker gets there, fee included, best first.
6. **Swap once per pool**, in that order, exact input, offering all the input still unsold. Each
   pool takes what it can fill before its price reaches its own limit; the Router's callback pays
   exactly that; the rest stays in the Pot for the next pool.
7. **Settle**: check the fill (`minOut`, `minAvgPrice`), send the output to `recipient`.
8. **Refund what is left of `amountIn`** to `refundTo`, and return the outcome from `main`. Only
   the rest of `amountIn` goes back, not the Pot's whole balance of the token: on an owner's Pot
   that also holds the token for other uses, a sweep would send those funds to `refundTo` too. A
   full sweep is right only for an intent body on the shared intent Pot, which holds nothing of
   anyone's between intents (`sauce-intents`).

**When the split is the best there is.** If the input is enough for every pool to reach its own
limit, every pool ends with its last unit costing exactly the caller's limit, fees included: equal
marginal cost everywhere, which is the optimal split, and the order changes nothing. The order
matters when the input runs out first: each pool, best first, is filled all the way to its limit
before the next gets anything, so a pool at the top that is thin is walked down to the limit while
deeper pools would have paid better for those units. The tighter the limit, the less this costs
(see "Getting the limit right").

**Why a partial fill cannot strand input.** Every venue here is a callback venue: the pool asks for
its input mid-swap and the Router pays exactly the delta, never more than offered. A pool that stops
at its limit simply takes less, and the remainder is still in the Pot, where the next swap or the
final refund picks it up. The program ends with **none of `amountIn` left in the Pot**: that refund
is not optional.

## Running it on Base

Everything that changes per trade is a `main` input, passed with the transaction (`--args`):

`main(tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, minAvgPrice, recipient, refundTo, v4Keys)`

`v4Keys` is `{ fee: Uint256; tickSpacing: Uint256 }[]`, the hookless V4 pools to try (below). The
only compile-time choices are the venues, as module constants that default to `0n`:

- `UniswapV3_Factory` and `UniswapV4_PoolManager` are set by the chain itself, on chains where the
  namespace contract is deployed (`sauce-globals`); elsewhere they stay `0n`.
- `PANCAKE_V3_FACTORY` and the three `SLIPSTREAM_*` factories are not namespace contracts, so the
  chain does not set them: pass them as defines. Left out, a venue is left out.

On Base, which has all of them, save the venues the chain does not set as `base-venues.json`. These
are the addresses the registry records (`pancakeswap-v3` role `factory`; `aerodrome-slipstream`
roles `clFactory`, `clFactoryGaugeCaps` and `clFactoryGaugesV3`). Each value is an address as a hex
string; give any large number as a string too, since a JSON number loses precision past 2^53:

```json
{
  "PANCAKE_V3_FACTORY": "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  "SLIPSTREAM_INITIAL": "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
  "SLIPSTREAM_GAUGE_CAPS": "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a",
  "SLIPSTREAM_GAUGES_V3": "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef"
}
```

Then, with a reference price of 2,700 USDC per WETH and a limit 0.5% from it (the numbers are worked
out under "Getting the limit right" and "Prices"), rehearse selling all of 1 WETH, with nothing
signed or sent, then sell it. The 2,700 is an example: take the reference from the pools at the
time, as "Getting the limit right" says, and convert it with `sauce price`. With a floor above the
market, no pool trades and `minOut` reverts the cook.

```sh
npx sauce simulate distributed-swap.sauce.ts --chain base --owner <address> \
  --config sauce.config.json --defines base-venues.json --assume-balance WETH:1 \
  --args 0x4200000000000000000000000000000000000006 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  1000000000000000000 4106511148422261116904015 2686500000 2686500000 <recipient> <refundTo> \
  '[{"fee":100,"tickSpacing":1},{"fee":500,"tickSpacing":10},{"fee":3000,"tickSpacing":60},{"fee":10000,"tickSpacing":200}]'
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --defines base-venues.json --fund WETH:1 \
  --args 0x4200000000000000000000000000000000000006 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  1000000000000000000 4106511148422261116904015 2686500000 2686500000 <recipient> <refundTo> \
  '[{"fee":100,"tickSpacing":1},{"fee":500,"tickSpacing":10},{"fee":3000,"tickSpacing":60},{"fee":10000,"tickSpacing":200}]'
```

Or buy WETH with up to 3,000 USDC, keeping what does not fill within the limit (`minOut` 0, the
rest refunded), with USDC pulled in by its own permit:

```sh
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --defines base-venues.json --fund USDC:3000 --fund-mode permit \
  --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x4200000000000000000000000000000000000006 \
  3000000000 4127095293177970497328754 0 368527731711811313801363553 <recipient> <refundTo> \
  '[{"fee":100,"tickSpacing":1},{"fee":500,"tickSpacing":10},{"fee":3000,"tickSpacing":60},{"fee":10000,"tickSpacing":200}]'
```

Each is one cook on the owner's Pot: `sauce tx` with the same flags and `--owner <address>` prints
it unsigned, `{ chainId, to, data, value }`, for any signer to send instead. `--define NAME=VALUE`
gives one value and wins over the file. On another chain, take the same roles from that chain's
deployments in
[../sauce-protocols/references/registry/pancakeswap-v3.md](../sauce-protocols/references/registry/pancakeswap-v3.md)
and
[../sauce-protocols/references/registry/aerodrome-slipstream.md](../sauce-protocols/references/registry/aerodrome-slipstream.md).

Each venue's discovery sits behind `if (<venue> != 0n)`, which folds at compile time, so a chain
without a venue compiles without it and never calls an address with no code. This is the pattern
for every venue a chain may lack; `UniswapV3.Factory` written directly is for a program that
requires it.

## Which venues it covers

A venue qualifies only if it takes a sqrt-price limit, since the limit is what makes each partial
fill safe and bounded. The program covers four, the price-limit venues the registry records with a
factory ABI, or a pool manager, that a program can use as it is:

| Venue                | Router entry | Pool lookup                                                                                        | Fee                                      | Address                                                                                                                                      |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Uniswap V3           | `swapV3`     | `getPool(a, b, fee)` on `UniswapV3_Factory`, fees `100n`, `500n`, `3000n`, `10000n`                | the tier                                 | the chain's `UniswapV3_Factory`                                                                                                              |
| PancakeSwap V3       | `swapV3`     | `getPool(a, b, fee)`, fees `100n`, `500n`, `2500n`, `10000n`                                       | the tier                                 | `pancakeswap-v3`: `PancakeSwapV3FactoryABI`, `factory` role (BSC, Ethereum, Arbitrum, Base, Linea)                                           |
| Aerodrome Slipstream | `swapV3`     | `getPool(a, b, tickSpacing)` on **every** factory, spacings `1n`, `50n`, `100n`, `200n`, `2000n`   | per pool, and it changes: read `fee()`   | `aerodrome-slipstream`: `SlipstreamCLFactoryABI`; Base has three factories (`clFactory`, `clFactoryGaugeCaps`, `clFactoryGaugesV3`), Arc one |
| Uniswap V4, hookless | `swapV4`     | none: the keys in `v4Keys`, each built into `{ currency0, currency1, fee, tickSpacing, hooks: 0 }` | the LP fee plus any protocol fee (below) | the chain's `UniswapV4_PoolManager`                                                                                                          |

A pair can have a Slipstream pool at the same tick spacing under more than one factory, each with its
own fee, so the program asks every factory for every spacing.

**Price-limit venues it leaves out, and why:**

- **Synthra V3 and UnitFlow V3** (Arc): the same `swapV3` and `getPool(a, b, fee)`, with factory
  ABIs in the registry (`synthra-v3`, `unitflow-v3`). Not in the program only to keep it to the
  venues of the chains it is checked on; add them as another venue (below).
- **Algebra pools** (Camelot V3 on Arbitrum, QuickSwap V3 on Polygon): the registry records the
  `v3Factory` address but no factory ABI with Algebra's `poolByPair(a, b)`, so there is no lookup to
  call. Pass the pool in as a `main` input; its price is the first word of `globalState()`, and its
  fee is dynamic.
- **PancakeSwap Infinity CL**: the Router's `swapInfinityCL` takes a price limit, but the registry
  records no PancakeSwap Infinity deployment on any chain, so a program has no vault or pool manager
  to name. Its key is also a different shape:
  `(currency0, currency1, hooks, poolManager, fee, parameters)`.
- **Hooked Uniswap V4 pools**: the hook is part of the pool's key and runs inside the swap; a key
  with a hook needs its address and a hook you have reviewed.
- Not price-limited at all, so never here: V2-style pairs, Curve, Balancer, DODO, Trader Joe LB and
  WOOFi fill in full at whatever price; Maverick V2 bounds by tick, not sqrt price.

## Uniswap V4 pools: the keys are an input

A V4 pool has no address and no factory to ask: it is a key,
`{ currency0, currency1, fee, tickSpacing, hooks }`, in the PoolManager. So `main` takes the keys to
try, `v4Keys`, as fee and tick spacing (hooks are zero; the currencies are the pair). **The default
is the four standard hookless keys**, fee/tick spacing 100/1, 500/10, 3000/60 and 10000/200:

```json
[
  { "fee": 100, "tickSpacing": 1 },
  { "fee": 500, "tickSpacing": 10 },
  { "fee": 3000, "tickSpacing": 60 },
  { "fee": 10000, "tickSpacing": 200 }
]
```

`[]` tries none. A key with no pool costs two reads and is skipped.

**There is no on-chain list of V4 pools.** A pool exists once someone initializes it, and the only
record is the PoolManager's `Initialize` event:

```solidity
event Initialize(PoolId indexed id, Currency indexed currency0, Currency indexed currency1,
  uint24 fee, int24 tickSpacing, IHooks hooks, uint160 sqrtPriceX96, int24 tick);
```

Its topic is `0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438`; `id`,
`currency0` and `currency1` are indexed, the second and third topics being the pair's addresses
(lower first) padded to 32 bytes. Finding every pool of a pair means scanning the PoolManager's logs
for that topic and pair, from its deployment to now, and keeping the ones whose `hooks` is zero;
then pass their `(fee, tickSpacing)` in `v4Keys`. That is a scan over the chain's history, done off
chain before the trade, and heavy (public endpoints cap the block range of a log query), which is
why the standard keys are the practical default.

## Reading a pool

Every read is an `evm.static` call with the selector, decoded as one word:

| What                       | V3-style pool (Uniswap V3, PancakeSwap V3, Slipstream) | Uniswap V4 pool, from its state in the PoolManager                                 |
| -------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| liquidity at current price | `liquidity()`, selector `0x1a686502`                   | the state's fourth word (first word + 3)                                           |
| current `sqrtPriceX96`     | first word of `slot0()`, selector `0x3850c7bd`         | bits 0–159 of the state's first word                                               |
| swap fee, in millionths    | `fee()`, selector `0xddca3f43`                         | LP fee in bits 208–231 of the first word, protocol fee in bits 184–207 (see below) |

- **A V4 pool's state** sits in the PoolManager's `pools` mapping (storage slot 6). A hookless
  pool's id is `crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n))`, its
  state's first word is at `crypto.keccak256(abi.encode(poolId, 6n))`, and the PoolManager's
  `extsload(bytes32)` (selector `0x1e2eaeaf`) reads a word. That first word packs `sqrtPriceX96`
  (bits 0–159), the tick (160–183), the protocol fee (184–207) and the LP fee (208–231). A key
  with no pool reads 0. Keys are built from the pair itself, so a V4 pool in native ETH (currency
  `0x0`) is a different pair and is never touched.
- **A V4 pool's fee** is its LP fee (a hookless key's own `fee`, fixed) plus the protocol fee for the
  direction, where one is switched on. The protocol fee field holds two 12-bit fees: selling token0
  in its low 12 bits (184–195), selling token1 in its high 12 (196–207). The protocol fee is taken
  first and the LP fee from the rest, so the swap fee is
  `protocolFee + lpFee - protocolFee * lpFee / 1000000`. Base's V4 charges one: its WETH/USDC
  500/10 pool reads an LP fee of 500 and a protocol fee of 125, so 625 effective, and 3000/60 reads
  3000 and 500, so 3,499. A hookless key never carries the dynamic-fee flag (`0x800000`), which
  needs a hook to set the fee.
- **A Slipstream pool's fee** is set per pool and changes over time (Base's tick-spacing-100
  WETH/USDC pool read 549 at one read and 639 at another), so the program reads `fee()` on every run
  rather than assuming the tick spacing's default.

**Liquidity before price: skip a pool with no liquidity at its price.** A pool can exist with none:
created or abandoned, its price stays wherever the last trade left it, often far from the market.
That price ranks it first, and its swap fills nothing (it only moves the empty pool's price to the
limit), at the cost of a call. Standard V4 keys are the usual case, since anyone can initialize one.
On Base, a cook that bought WETH ranked by price alone swapped the 10000/200 and 100/1 WETH/USDC V4
pools first, at 1,004 and 2,053 USDC per WETH with no liquidity, filled nothing from either, and left
both at its limit. So the program reads `liquidity()` (or the V4 state's fourth word) first and
drops a pool at zero before reading its price. To skip thin pools as well, compare the in-range
liquidity with a minimum instead of zero: it is in the same units on every V3-style and V4 pool of
the pair, whatever its fee or tick spacing.

## Ranking by the price a taker gets

A pool's `sqrtPriceX96` is its mid price, before its fee. Rank by what a taker gets instead. With
`spot = sqrtPriceX96² / 2^96` (token1 per token0, times 2^96) and `fee` in millionths:

- **selling token0** (the input is the lower address): the pool pays out `spot × (1 − fee)` token1
  per token0, and a **higher** one is better;
- **selling token1**: it charges `spot ÷ (1 − fee)` token1 per token0 bought, and a **lower** one is
  better.

**Why it matters.** Nobody arbitrages a pool until the gap to the market pays more than its fee, so
a 1% pool can sit up to about 1% from the market while a 0.01% pool tracks it closely, and ranked by
mid price alone the 1% pool often looks best. On Base, the Uniswap V3 1% WETH/USDC pool read
2,693.28 USDC per WETH: buying there costs 2,693.28 ÷ 0.99 ≈ 2,720.48 after its fee, against about
2,686.6 in the 0.01% pools at the same moment. Whenever the market sits on the far side of such a
pool, ranking by mid price fills it first, for over 1% less WETH.

## One limit for the caller, one per pool

A pool's `sqrtPriceLimitX96` bounds **the pool's price after the swap, not the price paid**: the fee
comes on top, so the last unit a pool fills at a given limit costs up to its fee more. Buying WETH
with every pool's limit at 2,713.5 USDC per WETH, the last WETH from a 0.3% pool costs about 2,713.5
÷ 0.997 ≈ 2,721.7 USDC, and from a 1% pool about 2,740.9.

So the program takes the caller's limit as the worst marginal price **paid**, fees included, and
gives each pool its own: where the pool's price falls during the swap (selling token0), it stops at
`limit ÷ √(1 − fee)`; where it rises (selling token1), at `limit × √(1 − fee)`. Every pool's last
unit then costs exactly the caller's limit, fee included, and every earlier unit less, so the
average is within the limit too. A pool whose price is not better than its own limit is skipped
(handed a limit on the wrong side of its price, a pool reverts), which also drops a pool whose fee
alone puts it past the caller's price. The square root is `Math.sqrt`, on integers scaled by
1e18:

```sauce chain=base,arbitrum
// Selling token0 (the lower address) pushes the price down, so a higher price is better.
function isBetter(price: Uint256, than: Uint256, sellsToken0: bool): bool {
  if (sellsToken0) {
    return price > than;
  }
  return price < than;
}

// The price a taker gets, fee included, as token1 per token0 times 2^96; fee in millionths.
function takerPrice(sqrtPriceX96: Uint256, fee: Uint256, sellsToken0: bool): Uint256 {
  const spot = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1n << 96n);
  if (sellsToken0) {
    return Math.mulDiv(spot, 1000000n - fee, 1000000n);
  }
  return Math.mulDiv(spot, 1000000n, 1000000n - fee);
}

// A pool's own limit, from the caller's limit on the price paid. Rounds toward stopping sooner.
function poolLimit(limit: Uint256, fee: Uint256, sellsToken0: bool): Uint256 {
  const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // √(1 − fee), times 1e18
  if (sellsToken0) {
    return Math.mulDiv(limit, 10n ** 18n, root);
  }
  return Math.mulDiv(limit, root, 10n ** 18n);
}

// Whether a pool with this price and fee trades under the caller's limit, and at what rank.
function main(sqrtPriceX96: Uint256, fee: Uint256, limit: Uint256, sellsToken0: bool): Uint256 {
  if (!isBetter(sqrtPriceX96, poolLimit(limit, fee, sellsToken0), sellsToken0)) {
    return 0n;
  }
  return takerPrice(sqrtPriceX96, fee, sellsToken0);
}
```

Ranking by liquidity depth instead (deepest first, so the pools that move least per unit absorb the
input first) is also sound, because the limit bounds every fill; it favours low price impact over
the best starting price.

## Getting the limit right

The limit is the one number that protects the trade: the ranking only decides which pool gets the
input first, and each pool is filled down (or up) to the limit. Set it from the market, close to it.

- **The reference is the best price a taker gets, fee included, among pools with liquidity.** Do
  what the program does: drop the pools with no in-range liquidity (or less than the order needs),
  work out each remaining pool's taker price, and take the best. Read `liquidity()`, `slot0()` and
  `fee()` (the selectors under "Reading a pool") with any client;
  `sauce price --chain base WETH USDC --sqrt-price-x96 <value>` turns a `sqrtPriceX96` back into
  USDC per WETH. A pool with no
  liquidity has the best price and the worst information, so it never sets the reference.
- **Not the deepest pool's mid price.** A pool's mid sits up to its fee away from the cheap pools.
  On Base, the deepest WETH/USDC pool was the Uniswap V3 0.3% pool at 2,692.06 USDC per WETH while
  the 0.01% pools traded at about 2,684.5: a limit meant as 1 bp past the deepest pool's price was
  about 0.28% past the cheap pools, so the trade accepted nearly thirty times the slippage intended.
- **The limit is the reference moved by the slippage you accept**: below it when selling token0 (a
  floor), above it when selling token1 (a ceiling). X% on the price is √(1 ± X) on
  `sqrtPriceX96`: 0.5% is × 0.99750 down or × 1.00250 up, **not** × 0.995 or × 1.005, which would
  be 1%. Or convert the moved price directly, as under "Prices".
- **The headroom decides which pools trade.** A pool trades only while its taker price, after its
  fee, is better than the limit. With the limit X past the best taker price, a pool sits out unless
  its taker price is within X of the best: among pools at the same mid price, one whose fee exceeds
  the best pool's by X or more sits out, and the cheapest pools fill only to their own limits. A
  limit at or inside the best taker price trades nothing and refunds everything, without reverting.
  No depth matching is needed: give enough headroom for the pools you want to reach.
- **A partial fill on a deep pair is a race.** For a small order on a very deep pair, the headroom
  that leaves a pool partly filled is a fraction of a basis point, and prices move every block. To
  see partial fills, use a thinner pair or a larger order.
- **Too loose costs real money.** On Base, with the market at about 2,686 USDC per WETH, a rehearsal
  selling 1 WETH with the floor at 1,500 sold it all into the first-ranked pool, a thin Slipstream
  pool, walked it down, and got 2,383 USDC; with the floor 0.5% below the market it got 2,685 from
  two pools.

**`minOut`, consistent with the limit.** Every unit trades at the limit or better, so a full fill
returns at least `amountIn ×` the limit's price. That is the recipe:

- **To sell all of `amountIn` or nothing**: `minOut = amountIn × limit price`, rounded up. Selling 1
  WETH with the floor at 2,686.5: `2686500000` (2,686.5 USDC). Buying with 3,000 USDC at the ceiling
  of 2,713.5: `3000e6 × 1e18 / 2713.5e6`, rounded up, `1105583195135433942`. When the pools cannot
  take all of it within the limit, the trade reverts; a partial fill passes only if its better
  prices make up for what did not sell.
- **To sell as much as fills within the limit, up to `amountIn`**: `minOut` is the least worth the
  gas (or `0`), and the rest is refunded. With enough input for every pool to reach its limit, this
  is the optimal split above.
- **`minAvgPrice`** (below) holds the average to a floor whatever the fill size. At the limit's own
  price it adds nothing the per-pool limits do not already guarantee; it is the guard for a stricter
  average, or for a program that gives every pool the same limit.

## One swap per pool

- `swapV3(pool, tokenIn, tokenOut, remaining, limit, self, self)`: a positive amount
  is exact input.
- `swapV4(UniswapV4_PoolManager, key, zeroForOne, -remaining, limit, self, self)`:
  a negative amount is exact input.
- Each swap is given its pool's own limit, not the caller's.
- `payer` and `recipient` are the Pot. Each helper returns the input the pool took (the Pot's input
  balance before minus after), which is simpler than decoding the returned deltas, and `main`
  subtracts it from what is still unsold. A ranked pool exists, has liquidity and is priced better
  than its limit, so its swap is expected to succeed; a revert reverts the whole program.

## Settlement and the result

- `minOut`: the least total output, in output-token units; `0` turns it off.
- `minAvgPrice`: the least average price actually achieved, in **output units per input unit,
  times 1e18**; `0` turns it off. The check is `bought * 1e18 >= minAvgPrice * spent`, where
  `spent` is the input the pools took, so it measures what the pools really took and paid, fees
  included.
- `bought` is the Pot's output-token balance after minus before, and only that is paid to
  `recipient`; the refund is `amountIn` minus what the pools took. Tokens the owner keeps in the Pot
  are not touched.
- **Return the outcome.** `main` is declared `: bytes` and ends with
  `return abi.encode(spent, bought, unspent)`: the input the pools took, the output paid, and the
  input refunded. The cook returns those 96 bytes as they are, one 32-byte word each.

**Reading a rehearsal.** `sauce simulate` (or any `eth_simulateV1` call of the cook) shows the trade
before anything is sent. The selling command above, run on Base, printed (pool addresses elided):

```text
The cook succeeds from <owner>: gas used 2115888, returns <96 bytes>
Token transfers:
  407.863869 USDC: <pool A> -> <Pot> (the Pot)
  2277.210044 USDC: <pool B> -> <Pot> (the Pot)
  2685.073913 USDC: <Pot> (the Pot) -> <recipient>
Net balance changes:
  <pool A>: -407.863869 USDC, +0.152217362513081071 WETH
  <Pot> (the Pot): -1 WETH
  <pool B>: -2277.210044 USDC, +0.847782637486918929 WETH
  <recipient>: +2685.073913 USDC
```

- **The 96 bytes after `returns`** are three 32-byte words: `spent` (here `0xde0b6b3a7640000`, 1
  WETH), `bought` (`0xa00af9f9`, 2,685.073913 USDC) and `unspent` (0).
- **Each pool that traded** shows in the net changes as an address that gave the output token and
  took the input: here two pools, 0.152 and 0.848 WETH. A pool you expected and do not see sat out:
  no liquidity, priced past its limit, or the input ran out first.
- **The Pot** shows only `amountIn` leaving; anything else it held is not in the list.
- **The average** is `bought ÷ spent` in whole tokens (2,685.07 USDC per WETH here), to compare
  with the reference and the limit before sending.

**Gas.** Rehearsed on Base: about 2.1 million gas to sell 1 WETH or to buy with 3,000 USDC (two to
four pools swapped), 4.5 million to sell 100 WETH (four pools, each crossing many ticks); a real
cook of the same design on Base used 3.17 million. The reads are the small part: discovery is one
lookup per factory and fee tier or tick spacing (23 on Base), then up to three reads per pool found
and two per V4 key; the four standard keys cost about 0.2 million there. The swaps, each crossing
ticks, are the rest. The gas is the same on any chain; what it costs is the chain's gas price, so
the same program costs far more on Ethereum than on Base.

## Prices

Token0 is the **lower address** of the pair on that chain, and a pool's price is token1 per token0
in base units. Take each token's decimals from
[../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md).

- **`sauce price --chain base WETH USDC 2686.5`** prints the pool's `sqrtPriceX96` at that price
  (which is also the swap's limit, a floor selling token0 and a ceiling selling token1) and the
  `minAvgPrice` for each direction, rounded up. `--sqrt-price-x96 <value>` reads a pool's price
  back. It reads no network.
- **By hand, from a human price to `sqrtPriceX96`**: with `P` the price of one whole token0 in whole
  token1 and `d0`, `d1` the decimals, `sqrtPriceX96 = floor(sqrt(P × 10^d1 / 10^d0) × 2^96)`,
  computed in integers as the integer square root of `P × 10^d1 × 2^192 / 10^d0`. A price quoted
  the other way (token0 per token1) is inverted first.
- **Back**: `P = sqrtPriceX96² × 10^d0 / (2^192 × 10^d1)`.
- On Base (and Arbitrum) WETH is token0, 18 decimals, and USDC token1, 6. With the reference at
  2,700 USDC per WETH, **4116816085950893928074568**, and 0.5% either side:
  - selling WETH, the floor 2,686.5 is **4106511148422261116904015** (the reference × 0.99750),
    and `minAvgPrice` is `2686.5e6 × 1e18 / 1e18`, **2686500000**;
  - buying WETH, the ceiling 2,713.5 is **4127095293177970497328754** (the reference × 1.00250),
    and `minAvgPrice` is `1e18 × 1e18 / 2713.5e6` rounded up,
    **368527731711811313801363553**.
  - Back, 4116816085950893928074568² × 10^18 / (2^192 × 10^6) is just under 2,700.
- On Ethereum USDC is token0, so the same price is a different number there.
- The program branches on `tokenIn < tokenOut` at run time, so the same bytecode trades either way.

## Adapting it

- **Another chain**: pass its `--chain`. The chain sets the Uniswap venues; pass the PancakeSwap V3
  and Slipstream factories from that chain's registry rows as defines, or leave them out.
- **Another venue**: add a constant for its factory, defaulting to `0n`, and its lookups behind
  `if (<constant> != 0n)`, and grow the discovery array; `swapIntoV3` already drives every
  V3-style pool the Router services. For Algebra pools, read `globalState()` for the price.
- **More V4 pools**: pass their `(fee, tickSpacing)` in `v4Keys`, found through the `Initialize`
  logs. A hooked pool needs its `hooks` address (in the pool id and the key) and a hook you have
  reviewed.
- The input must be in the Pot before the program runs: for a direct cook, the Pot's owner funds it
  (or `--fund` pulls it in with the cook); for an intent, the solver delivers it (`sauce-intents`).
  Compile and send it with `sauce-run`, passing the venue defines above.

## Before sending

- The reference is the best fee-inclusive taker price among pools with liquidity, and the limit is
  that reference moved by the slippage you accept.
- The headroom reaches the pools that should trade.
- `minOut` follows the recipe: `amountIn ×` the limit's price to sell everything, less to accept a
  partial fill.
- `v4Keys` is the four standard keys, the keys found in the logs, or `[]`.
- A rehearsal shows the pools you expected, an average near the reference, and `unspent` as
  intended.
