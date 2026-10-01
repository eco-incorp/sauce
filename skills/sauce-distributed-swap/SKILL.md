---
name: sauce-distributed-swap
description: Writing a Sauce program that distributes one exact-input swap across every pool on a chain that supports a price limit (Uniswap V3 and its forks such as PancakeSwap V3, Aerodrome Slipstream, Algebra, Synthra and UnitFlow pools, plus Uniswap V4), never trading past a common sqrtPriceLimitX96 and never stranding input. Covers which venues qualify, making one program compile on every chain whatever venues it has, discovering pools through the factories, ordering them best price first, one swap per pool with the leftover flowing on, and settlement with a minimum output, an average-price floor and a refund, all as main(...) inputs. Use when asked for a distributed, split, multi-venue, aggregated or best-execution swap, "swap across all protocols", "fill up to a price limit", a limit-order-like swap, or routing one trade through several pools.
---

# A distributed swap across price-limit venues

The reference program is
[examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts). It names no chain, so one
file compiles for every chain, with the venues that chain has;
[examples/distributed-swap.mts](examples/distributed-swap.mts) compiles it for Base and Arbitrum
with every venue those chains have and builds the cook with its inputs. Start from it; this skill
explains its design. The same swap as the body of a cross-chain intent, paid for on another chain,
is [../sauce-intents/examples/swap-on-base.sauce.ts](../sauce-intents/examples/swap-on-base.sauce.ts).

## The design

The owner puts **enough input in the Pot to fill every pool up to the limit**. The program does not
try to split the amount perfectly; the limit does the splitting.

1. **Discover** the pair's pools on every price-limit venue the chain has, with their current
   prices: V3-style pools through their factories, Uniswap V4 pools by key.
2. **Order** them all best price first, V3-style and V4 alike, skipping any pool already priced past
   the limit.
3. **Swap once per pool**, in that order, offering all the input still unsold with the common
   `sqrtPriceLimitX96`. Each pool takes what it can fill before its price reaches the limit; the
   Router's callback pays exactly that; the rest stays in the Pot for the next pool. Stop once
   nothing is left.
4. **Settle**: check the fill (`minOut`, `minAvgPrice`), send the output to `recipient`, and return
   every unspent input token to `refundTo`.

**Why the order matters only sometimes.** When the input is enough, every pool ends at the limit,
and how much each one fills depends only on its liquidity between its current price and the limit:
the order changes nothing. It matters when the input runs out first, because the pools reached last
get less or nothing. Best price first means the input that is sold is sold at the best prices on
offer.

**Why a partial fill cannot strand input.** Every venue here is a callback venue: the pool asks for
its input mid-swap and the Router pays exactly the delta, never more than offered. A pool that stops
at the limit simply takes less, and the remainder is still in the Pot, where the next swap or the
final refund picks it up. The program ends with **no input left in the Pot**: that refund is not
optional.

## Inputs and compile-time choices

Everything that changes per trade is a `main` input, passed with the transaction (`--args`):
`main(tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, minAvgPrice, recipient, refundTo)`.
The only compile-time choices are the venues, as module constants that default to `0n`:

- `UniswapV3_Factory` and `UniswapV4_PoolManager` are set by the chain itself, on chains where the
  namespace contract is deployed (`sauce-globals`); elsewhere they stay `0n`.
- `PANCAKE_V3_FACTORY` and the three `SLIPSTREAM_*` factories are not namespace contracts, so the
  chain does not set them: pass each with `--define`, from the address tables in
  [../sauce-protocols/references/pancakeswap-v3.md](../sauce-protocols/references/pancakeswap-v3.md)
  and
  [../sauce-protocols/references/aerodrome-slipstream.md](../sauce-protocols/references/aerodrome-slipstream.md)
  (or the registry modules' `deployments`, as the runner reads them). Left out, the venue is left
  out.

On Base, which has all of them, selling 1 WETH for USDC down to 1,500 USDC per WETH (WETH is
token0 there, so the limit is a floor):

```sh
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --define PANCAKE_V3_FACTORY=<factory> \
  --define SLIPSTREAM_INITIAL=<clFactory> --define SLIPSTREAM_GAUGE_CAPS=<clFactoryGaugeCaps> \
  --define SLIPSTREAM_GAUGES_V3=<clFactoryGaugesV3> --fund WETH:1 \
  --args <WETH> <USDC> 1000000000000000000 3068493539683605256287027 0 1500000000 \
  <recipient> <refundTo>
```

Each venue's discovery sits behind `if (<venue> != 0n)`, which folds at compile time, so a chain
without a venue compiles without it and never calls an address with no code. This is the pattern
for every venue a chain may lack; `UniswapV3.Factory` written directly is for a program that
requires it.

## Which venues qualify

A venue qualifies only if it takes a sqrt-price limit, since the limit is what makes each partial
fill safe and bounded. The chains each namespace contract is deployed on are in
[../sauce-globals/references/protocols.md](../sauce-globals/references/protocols.md).

| Venue                                    | Router entry | Pool lookup                                                                                                                           | Address                                                                                                                                      |
| ---------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Uniswap V3                               | `swapV3`     | `getPool(a, b, fee)` on `UniswapV3_Factory`, fees `100n`, `500n`, `3000n`, `10000n`                                                   | the chain's `UniswapV3_Factory`                                                                                                              |
| PancakeSwap V3                           | `swapV3`     | `getPool(a, b, fee)`, fees `100n`, `500n`, `2500n`, `10000n`                                                                          | `pancakeswap-v3`: `PancakeSwapV3FactoryABI`, `factory` role (BSC, Ethereum, Arbitrum, Base, Linea)                                           |
| Aerodrome Slipstream                     | `swapV3`     | `getPool(a, b, tickSpacing)`, spacings `1n`, `50n`, `100n`, `200n`, `2000n`                                                           | `aerodrome-slipstream`: `SlipstreamCLFactoryABI`; Base has three factories (`clFactory`, `clFactoryGaugeCaps`, `clFactoryGaugesV3`), Arc one |
| Synthra V3, UnitFlow V3                  | `swapV3`     | `getPool(a, b, fee)`                                                                                                                  | `synthra-v3` / `unitflow-v3` factory ABIs (Arc)                                                                                              |
| Algebra pools (Camelot V3, QuickSwap V3) | `swapV3`     | the registry records the `v3Factory` address but no factory ABI with Algebra's `poolByPair(a, b)`: pass the pool in as a `main` input | `camelot` (Arbitrum), `quickswap` (Polygon)                                                                                                  |
| Uniswap V4                               | `swapV4`     | no factory: build the key `{ currency0, currency1, fee, tickSpacing, hooks }`                                                         | the chain's `UniswapV4_PoolManager`                                                                                                          |

Leave out venues without a price limit (V2-style pairs, Curve, Balancer, DODO, Trader Joe LB,
WOOFi): they fill in full at whatever price. Maverick V2 bounds by tick, not sqrt price.

## Ordering

- **By price** (the reference): the current `sqrtPriceX96` of a V3-style pool is the first word of
  `slot0()` (selector `0x3850c7bd`) on Uniswap V3, PancakeSwap V3, Slipstream, Synthra and UnitFlow,
  and the first word of `globalState()` on Algebra pools. Selling token0 (the input is the lower
  address) moves the price down, so a **higher** sqrtPrice is better; selling token1, a **lower** one
  is. A pool whose price is not better than the limit cannot trade and is skipped.
- **Uniswap V4 pools** are ranked with the others. A hookless pool's id is
  `crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n))`; its state sits in the
  PoolManager's `pools` mapping (storage slot 6), at `crypto.keccak256(abi.encode(poolId, 6n))`,
  and the PoolManager's `extsload(bytes32)` (selector `0x1e2eaeaf`) returns its first word, whose low
  160 bits are the `sqrtPriceX96`. A key with no pool reads 0 and is skipped. Keys are built from the
  pair itself, so a V4 pool in native ETH (currency `0x0`) is a different pair and is never touched.
- **By liquidity depth** (an alternative): read each pool's in-range `liquidity()` instead and
  sort deepest first, so the pools that move least per unit absorb the input first. It favours low
  price impact over the best starting price; either key is sound, because the limit bounds every
  fill.
- **The sort**: collect every candidate with its price, then insertion-sort the indexes of those
  priced better than the limit, best first. Each index names a V3-style pool address, or (pool `0`)
  a V4 key's fee and tick spacing.

The core, for Uniswap V3 alone:

```sauce chain=base,arbitrum
import { ISauceRouter } from "./artifacts/ISauceRouter.json";
import IUniswapV3Factory from "./protocols/uniswap-v3/UniswapV3FactoryABI.json";

const UniswapV3_Factory = 0n; // the chain's factory, where it has one

function isBetter(price, than, tokenIn, tokenOut) {
  if (tokenIn < tokenOut) {
    return price > than;
  }
  return price < than;
}

function spotPrice(pool) {
  const slot0 = hex`3850c7bd`;
  const [sqrtPriceX96] = abi.decode(evm.static(pool, slot0), ["Uint256"]);
  return sqrtPriceX96;
}

function main(tokenIn: Address, tokenOut: Address, sqrtPriceLimitX96: Uint256, recipient: Address) {
  const self = ctx.self();
  const outBefore = Token(tokenOut).balanceOf(self);
  let pools = new Array(4);
  let prices = new Array(4);
  let count = 0n;
  if (UniswapV3_Factory != 0n) {
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      const pool = IUniswapV3Factory.at(UniswapV3_Factory).getPool(tokenIn, tokenOut, fee);
      if (pool != 0n) {
        const price = spotPrice(pool);
        if (isBetter(price, sqrtPriceLimitX96, tokenIn, tokenOut)) {
          let j = count;
          while (j > 0n && isBetter(price, prices[j - 1n], tokenIn, tokenOut)) {
            pools[j] = pools[j - 1n];
            prices[j] = prices[j - 1n];
            j--;
          }
          pools[j] = pool;
          prices[j] = price;
          count++;
        }
      }
    }
  }
  const router = ISauceRouter.at(self);
  for (let i = 0n; i < count; i++) {
    const remaining = Token(tokenIn).balanceOf(self);
    if (remaining > 0n) {
      router.swapV3(pools[i], tokenIn, tokenOut, remaining, sqrtPriceLimitX96, self, self);
    }
  }
  Token(tokenOut).transfer(recipient, Token(tokenOut).balanceOf(self) - outBefore);
  Token(tokenIn).transfer(recipient, Token(tokenIn).balanceOf(self));
}
```

## One swap per pool

- `swapV3(pool, tokenIn, tokenOut, remaining, sqrtPriceLimitX96, self, self)`: a positive amount
  is exact input.
- `swapV4(UniswapV4_PoolManager, key, zeroForOne, -remaining, sqrtPriceLimitX96, self, self)`:
  a negative amount is exact input.
- `payer` and `recipient` are the Pot. Each helper returns the input the pool took (the Pot's input
  balance before minus after), which is simpler than decoding the returned deltas, and `main`
  subtracts it from what is still unsold. A ranked pool exists and is priced better than the limit,
  so its swap is expected to succeed; a revert reverts the whole program.

## Settlement

- `minOut`: the least total output, in output-token units; `0` turns it off.
- `minAvgPrice`: the least average price actually achieved, in **output units per input unit,
  times 1e18**; `0` turns it off. The check is `out * 1e18 >= minAvgPrice * spent`, where `spent`
  is the input the pools took. For WETH→USDC, 1,500 USDC per WETH is `1500e6 * 1e18 / 1e18`, that is
  `1_500_000_000n`. The price limit already bounds the worst marginal price; this bounds the
  average, and with `minOut` it guards a fill that is too small to be worth it.
- Pay the output to `recipient` and **return every unspent input token** to `refundTo`.

## Getting the limit right

- `sqrtPriceLimitX96 = floor(sqrt(token1Units / token0Units) * 2^96)`, token0 the lower address of
  the pair **on that chain**, with each token's decimals from [tokens.md](../sauce-globals/references/tokens.md).
  For WETH→USDC on Base and on Arbitrum (WETH is token0 on both), 1,500 USDC per WETH is
  3068493539683605256287027, the integer square root of 1500e6 × 2^192 / 1e18. The runner's
  `sqrtPriceX96` helper computes it.
- Selling token0 the limit is a floor below the current price; selling token1 a ceiling above it.
  The program's comparisons branch on `tokenIn < tokenOut` at run time, so the same bytecode sells
  either way.

## Adapting it

- **Another chain**: pass its `--chain`. The chain sets the Uniswap venues; pass the PancakeSwap V3
  and Slipstream factories from that chain's registry rows with `--define`, or leave them out.
- **Another venue**: add a constant for its factory, defaulting to `0n`, and its lookups behind
  `if (<constant> != 0n)`; `swapIntoV3` already drives every V3-style pool the Router services. For
  Algebra pools, read `globalState()` for the price.
- **More V4 pools**: add their `(fee, tickSpacing)` keys; a hooked pool needs its `hooks` address
  (in the pool id and the key) and a hook you have reviewed.
- The input must be in the Pot before the program runs: for a direct cook, the Pot's owner funds it
  (or `--fund` pulls it in with the cook); for an intent, the solver delivers it (`sauce-intents`).
  Compile and send it with `sauce-run`, passing the venue defines above.
