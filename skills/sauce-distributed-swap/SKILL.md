---
name: sauce-distributed-swap
description: Writing a Sauce program that distributes one exact-input swap across every pool on a chain that supports a price limit (Uniswap V3 and forks such as PancakeSwap V3, Aerodrome Slipstream, Algebra, Synthra and UnitFlow pools, plus Uniswap V4), never paying past the caller's price and never stranding input. Covers which venues qualify, one program for every chain whatever venues it has, discovering pools through the factories, skipping pools with no liquidity, reading each pool's fee, a fee-adjusted limit per pool, ranking by the price a taker gets fee included, one swap per pool with the leftover flowing on, settlement with a minimum output, an average-price floor and a refund, returning the outcome, and converting prices to sqrtPriceX96 and back. Use when asked for a distributed, split, multi-venue, aggregated or best-execution swap, "swap across all protocols", "fill up to a price limit", a limit-order-like swap, or routing one trade through several pools.
---

# A distributed swap across price-limit venues

The reference program is
[examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts). It names no chain, so one
file compiles for every chain, with the venues that chain has;
[examples/distributed-swap.mts](examples/distributed-swap.mts) compiles it for Base and Arbitrum
with every venue those chains have and builds the cook with its inputs. Start from it; this skill
explains its design and gives every value a run on Base needs. The same swap as the body of a
cross-chain intent, paid for on another chain, is
[../sauce-intents/examples/swap-on-base.sauce.ts](../sauce-intents/examples/swap-on-base.sauce.ts).

## The design

The owner puts **enough input in the Pot to fill every pool up to the limit**. The program does not
try to split the amount perfectly; the limit does the splitting.

1. **Discover** the pair's pools on every price-limit venue the chain has: V3-style pools through
   their factories, Uniswap V4 pools by key.
2. **Give each pool its own limit.** The caller's `sqrtPriceLimitX96` is the worst price a taker
   accepts, **fee included**; each pool gets the price limit at which its price, less its fee,
   reaches it. **Keep** the pools that can trade: liquidity at their current price, and a price
   better than their own limit.
3. **Rank** them by the price a taker gets there, fee included, best first.
4. **Swap once per pool**, in that order, offering all the input still unsold, up to the pool's own
   limit. Each pool takes what it can fill before its price reaches that limit; the Router's
   callback pays exactly that; the rest stays in the Pot for the next pool. Stop once nothing is
   left.
5. **Settle**: check the fill (`minOut`, `minAvgPrice`), send the output to `recipient`, return every
   unspent input token to `refundTo`, and return the outcome from `main`.

**Why the order matters only sometimes.** When the input is enough, every pool ends at its limit,
and how much each one fills depends only on its liquidity between its current price and that limit:
the order changes nothing. It matters when the input runs out first, because the pools reached last
get less or nothing. Best taker price first means the input that is sold is sold at the best prices
on offer.

**Why a partial fill cannot strand input.** Every venue here is a callback venue: the pool asks for
its input mid-swap and the Router pays exactly the delta, never more than offered. A pool that stops
at the limit simply takes less, and the remainder is still in the Pot, where the next swap or the
final refund picks it up. The program ends with **no input left in the Pot**: that refund is not
optional.

## Running it on Base

Everything that changes per trade is a `main` input, passed with the transaction (`--args`):
`main(tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, minAvgPrice, recipient, refundTo)`.
The only compile-time choices are the venues, as module constants that default to `0n`:

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

Then, selling 1 WETH for USDC at no less than 1,500 USDC per WETH, or buying WETH with 3,000 USDC
at no more than 2,707 USDC per WETH (the numbers are worked out under "Prices" below):

```sh
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --defines base-venues.json --fund WETH:1 \
  --args <WETH> <USDC> 1000000000000000000 3068493539683605256287027 0 1500000000 \
  <recipient> <refundTo>
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --defines base-venues.json --fund USDC:3000 \
  --args <USDC> <WETH> 3000000000 4122149244956051421750688 0 369412633912079793128925009 \
  <recipient> <refundTo>
```

`--define NAME=VALUE` gives one value and wins over the file. On another chain, take the same roles
from that chain's rows of
[../sauce-protocols/references/pancakeswap-v3.md](../sauce-protocols/references/pancakeswap-v3.md)
and
[../sauce-protocols/references/aerodrome-slipstream.md](../sauce-protocols/references/aerodrome-slipstream.md)
(or the registry modules' `deployments`, as the runner reads them).

Each venue's discovery sits behind `if (<venue> != 0n)`, which folds at compile time, so a chain
without a venue compiles without it and never calls an address with no code. This is the pattern
for every venue a chain may lack; `UniswapV3.Factory` written directly is for a program that
requires it.

## Which venues qualify

A venue qualifies only if it takes a sqrt-price limit, since the limit is what makes each partial
fill safe and bounded. The chains each namespace contract is deployed on are in
[../sauce-globals/references/protocols.md](../sauce-globals/references/protocols.md).

| Venue                                    | Router entry | Pool lookup                                                                                                                            | Fee                                            | Address                                                                                                                                      |
| ---------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Uniswap V3                               | `swapV3`     | `getPool(a, b, fee)` on `UniswapV3_Factory`, fees `100n`, `500n`, `3000n`, `10000n`                                                    | the tier                                       | the chain's `UniswapV3_Factory`                                                                                                              |
| PancakeSwap V3                           | `swapV3`     | `getPool(a, b, fee)`, fees `100n`, `500n`, `2500n`, `10000n`                                                                           | the tier                                       | `pancakeswap-v3`: `PancakeSwapV3FactoryABI`, `factory` role (BSC, Ethereum, Arbitrum, Base, Linea)                                           |
| Aerodrome Slipstream                     | `swapV3`     | `getPool(a, b, tickSpacing)` on **every** factory, spacings `1n`, `50n`, `100n`, `200n`, `2000n`                                       | per pool, and it changes: read `fee()`         | `aerodrome-slipstream`: `SlipstreamCLFactoryABI`; Base has three factories (`clFactory`, `clFactoryGaugeCaps`, `clFactoryGaugesV3`), Arc one |
| Synthra V3, UnitFlow V3                  | `swapV3`     | `getPool(a, b, fee)`                                                                                                                   | the tier                                       | `synthra-v3` / `unitflow-v3` factory ABIs (Arc)                                                                                              |
| Algebra pools (Camelot V3, QuickSwap V3) | `swapV3`     | the registry records the `v3Factory` address but no factory ABI with Algebra's `poolByPair(a, b)`: pass the pool in as a `main` input  | dynamic: read it from the pool                 | `camelot` (Arbitrum), `quickswap` (Polygon)                                                                                                  |
| Uniswap V4                               | `swapV4`     | no factory: build the key `{ currency0, currency1, fee, tickSpacing, hooks }`; the standard keys are 100/1, 500/10, 3000/60, 10000/200 | the key's LP fee plus any protocol fee (below) | the chain's `UniswapV4_PoolManager`                                                                                                          |

A pair can have a Slipstream pool at the same tick spacing under more than one factory, each with its
own fee, so ask every factory for every spacing. Leave out venues without a price limit (V2-style
pairs, Curve, Balancer, DODO, Trader Joe LB, WOOFi): they fill in full at whatever price. Maverick
V2 bounds by tick, not sqrt price.

## Reading a pool

Every read is an `evm.static` call with the selector, decoded as one word:

| What                       | V3-style pool (Uniswap V3, PancakeSwap V3, Slipstream, Synthra, UnitFlow) | Uniswap V4 pool, from its state in the PoolManager                                 |
| -------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| current `sqrtPriceX96`     | first word of `slot0()`, selector `0x3850c7bd`                            | low 160 bits of the state's first word                                             |
| liquidity at current price | `liquidity()`, selector `0x1a686502`                                      | the state's fourth word (first word + 3)                                           |
| swap fee, in millionths    | `fee()`, selector `0xddca3f43`                                            | LP fee in bits 208–231 of the first word, protocol fee in bits 184–207 (see below) |

- **A V4 pool's state** sits in the PoolManager's `pools` mapping (storage slot 6). A hookless
  pool's id is `crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n))`, its
  state's first word is at `crypto.keccak256(abi.encode(poolId, 6n))`, and the PoolManager's
  `extsload(bytes32)` (selector `0x1e2eaeaf`) reads a word. A key with no pool reads 0. Keys are
  built from the pair itself, so a V4 pool in native ETH (currency `0x0`) is a different pair and
  is never touched.
- **A V4 pool's fee** is its LP fee (a hookless key's own `fee`, fixed) plus the protocol fee for the
  direction, where one is switched on: the protocol fee field holds selling token0's fee in its low
  12 bits and selling token1's in its high 12, and the swap fee is
  `protocolFee + lpFee - protocolFee * lpFee / 1000000`. A protocol fee can make a V4 pool cost more
  than its key says, so read it. A hookless key never carries the dynamic-fee flag (`0x800000`),
  which needs a hook to set the fee.
- **On Algebra pools** the price is the first word of `globalState()`.

**Skip a pool with no liquidity at its price.** A pool can exist with none: created or abandoned,
its price stays wherever the last trade left it, often far from the market. That price ranks it
first, and its swap fills nothing (it only moves the empty pool's price to the limit), at the cost of
a call. Standard V4 keys are the usual case, since anyone can initialize one: on Base, two WETH/USDC
keys hold such pools, far below the market, and a WETH purchase ranked by price alone swapped them
first for nothing.

## Ranking by the price a taker gets

A pool's `sqrtPriceX96` is its mid price, before its fee. Rank by what a taker gets instead. With
`spot = sqrtPriceX96² / 2^96` (token1 per token0, times 2^96) and `fee` in millionths:

- **selling token0** (the input is the lower address): the pool pays out `spot × (1 − fee)` token1
  per token0, and a **higher** one is better;
- **selling token1**: it charges `spot ÷ (1 − fee)` token1 per token0 bought, and a **lower** one is
  better.

**Why it matters.** Nobody arbitrages a pool until the gap to the market pays more than its fee, so
a 1% pool can sit up to about 1% from the market while a 0.05% pool tracks it closely, and ranked by
mid price alone the 1% pool often looks best. Buying WETH, a 1% pool at 2,690 USDC per WETH looks
better than a 0.05% pool at 2,700, but costs 2,690 ÷ 0.99 ≈ 2,717 against 2,700 ÷ 0.9995 ≈ 2,701.
Ranked by mid price, the 1% pool would be filled first, and the 0.05% and 0.01% pools only with
what is left.

## One limit for the caller, one per pool

A pool's `sqrtPriceLimitX96` bounds **the pool's price after the swap, not the price paid**: the fee
comes on top, so the last unit a pool fills at a given limit costs up to its fee more. Buying WETH
with every pool's limit at 2,707 USDC per WETH, the last WETH from a 0.3% pool costs about 2,707 ÷
0.997 ≈ 2,715 USDC, and from a 1% pool about 2,734.

So the program takes the caller's limit as the worst price **paid**, fee included, and gives each
pool its own: selling token0 the price falls, and the pool stops at `limit ÷ √(1 − fee)`; selling
token1 it rises, and the pool stops at `limit × √(1 − fee)`. Every unit then trades at the
caller's limit or better, so the average does too. A pool whose price is not better than its own
limit is skipped (handed a limit on the wrong side of its price, a pool reverts), which also drops
a pool whose fee alone puts it past the caller's price.

The helpers that carry this, as the example writes them:

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
  included. The per-pool limits already hold the average to the caller's limit; `minAvgPrice` is a
  stricter floor on the average, or the guard for a program that gives every pool the same limit.
  With `minOut` it also guards a fill too small to be worth it.
- Pay the output to `recipient` and **return every unspent input token** to `refundTo`.
- **Return the outcome.** `main` is declared `: bytes` and ends with
  `return abi.encode(spent, bought, unspent)`. The cook returns those 96 bytes as they are, one
  32-byte word each, and `sauce simulate` prints them, so a rehearsal shows how much would sell and
  for how much before anything is sent.

## Prices

Token0 is the **lower address** of the pair on that chain, and a pool's price is token1 per token0
in base units. Take each token's decimals from
[../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md).

- **From a human price to `sqrtPriceX96`**: with `P` the price of one whole token0 in whole token1
  and `d0`, `d1` the decimals,
  `sqrtPriceX96 = floor(sqrt(P × 10^d1 / 10^d0) × 2^96)`, computed in integers as the integer square
  root of `P × 10^d1 × 2^192 / 10^d0`. A price quoted the other way (token0 per token1) is inverted
  first.
- **Back**: `P = sqrtPriceX96² × 10^d0 / (2^192 × 10^d1)`.
- On Base (and Arbitrum) WETH is token0, 18 decimals, and USDC token1, 6: 1,500 USDC per WETH is
  the integer square root of 1500 × 10^6 × 2^192 / 10^18, **3068493539683605256287027**, and 2,707
  is **4122149244956051421750688**. Back, 4122149244956051421750688² × 10^18 / (2^192 × 10^6) ≈
  2,707. On Ethereum USDC is token0, so the same price is a different number there.
- **The limit** is the worst price paid, fee included (the program gives each pool its own, above):
  selling token0 it is a floor below the current price; selling token1, a ceiling above it. Selling
  WETH for USDC on Base sells token0 (floor); buying WETH sells USDC, token1 (ceiling). The program
  branches on `tokenIn < tokenOut` at run time, so the same bytecode trades either way.
- **`minAvgPrice`** is the worst average you accept, as output units per input unit times 1e18 (it
  can be the limit's own price, or stricter):
  - selling WETH for USDC at no less than 1,500 USDC per WETH: `1500e6 × 1e18 / 1e18`,
    **1500000000**;
  - buying WETH with USDC at no more than 2,707 USDC per WETH: `1e18 × 1e18 / 2707e6`, that is
    `1e36 / 2707e6`, **369412633912079793128925009** (rounded down, so it allows a hair more than
    2,707).

The runner's `sqrtPriceX96` and `minAvgPrice` helpers compute both, and it checks the numbers here.

## Adapting it

- **Another chain**: pass its `--chain`. The chain sets the Uniswap venues; pass the PancakeSwap V3
  and Slipstream factories from that chain's registry rows as defines, or leave them out.
- **Another venue**: add a constant for its factory, defaulting to `0n`, and its lookups behind
  `if (<constant> != 0n)`; `swapIntoV3` already drives every V3-style pool the Router services. For
  Algebra pools, read `globalState()` for the price.
- **More V4 pools**: add their `(fee, tickSpacing)` keys; a hooked pool needs its `hooks` address
  (in the pool id and the key) and a hook you have reviewed.
- The input must be in the Pot before the program runs: for a direct cook, the Pot's owner funds it
  (or `--fund` pulls it in with the cook); for an intent, the solver delivers it (`sauce-intents`).
  Compile and send it with `sauce-run`, passing the venue defines above.
