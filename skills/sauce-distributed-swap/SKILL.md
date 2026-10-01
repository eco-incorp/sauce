---
name: sauce-distributed-swap
description: Writing a Sauce program that distributes one exact-input swap across every pool on a chain that supports a price limit (Uniswap V3 and its forks such as PancakeSwap V3, Aerodrome Slipstream, Algebra, Synthra and UnitFlow pools, plus Uniswap V4), never trading past a common sqrtPriceLimitX96 and never stranding input. Covers which venues qualify, making one program compile on every chain whatever venues it has, discovering pools through the factories, ordering them best price first, one swap per pool with the leftover flowing on, and settlement with a minimum output, an average-price floor and a refund, all as main(...) inputs. Use when asked for a distributed, split, multi-venue, aggregated or best-execution swap, "swap across all protocols", "fill up to a price limit", a limit-order-like swap, or routing one trade through several pools.
---

<!-- check:allow globalState poolByPair liquidity -->

# A distributed swap across price-limit venues

The reference program is
[examples/distributed-swap.sauce.ts](examples/distributed-swap.sauce.ts). It names no chain, so one
file compiles for every chain, with the venues that chain has;
[examples/distributed-swap.mts](examples/distributed-swap.mts) compiles it for Base, Arbitrum and
Optimism, each with the venues it has, and builds the cook with its inputs. Start from it; this skill
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

## Inputs, and the venues a chain has

Everything that changes per trade is a `main` input, passed with the transaction (`--args`):
`main(tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, minAvgPrice, recipient, refundTo)`.
The venues need no input: each is a protocol namespace (`sauce-globals`), used only where the chain
it is compiled for has it.

On Base, selling 1 WETH for USDC down to 1,500 USDC per WETH (WETH is token0 there, so the limit is
a floor):

```sh
npx sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --fund WETH:1 \
  --args <WETH> <USDC> 1000000000000000000 3068493539683605256287027 0 1500000000 \
  <recipient> <refundTo>
```

Each venue's discovery sits behind `if (available(<Namespace.Contract>))`, which is decided when the
file is compiled for a chain: a chain without the venue compiles without that branch, so the
program never names a contract the chain lacks and never calls an address with no code. A helper
that uses a venue starts with the guard `if (!available(UniswapV4.StateView)) { return 0n; }`, which
drops the rest of its body on such a chain. Written without `available(...)`, a venue is required:
the program does not compile for a chain that lacks it.

## Which venues qualify

A venue qualifies only if it takes a sqrt-price limit, since the limit is what makes each partial
fill safe and bounded. The chains each namespace contract is deployed on are in
[../sauce-globals/references/protocols.md](../sauce-globals/references/protocols.md).

| Venue                                    | Swap        | Pool lookup                                                                                                                  | Namespace                                                                                        |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Uniswap V3                               | `uniswapV3` | `getPool(a, b, fee)`, fees `100n`, `500n`, `3000n`, `10000n`                                                                 | `UniswapV3.Factory`                                                                              |
| PancakeSwap V3                           | `uniswapV3` | `getPool(a, b, fee)`, fees `100n`, `500n`, `2500n`, `10000n`                                                                 | `PancakeswapV3.Factory`                                                                          |
| Aerodrome Slipstream                     | `uniswapV3` | `getPool(a, b, tickSpacing)`, spacings `1n`, `50n`, `100n`, `200n`, `2000n`                                                  | `AerodromeSlipstream.CLFactory`, and on Base also `.CLFactoryGaugeCaps` and `.CLFactoryGaugesV3` |
| Synthra V3, UnitFlow V3                  | `uniswapV3` | `getPool(a, b, fee)`                                                                                                         | `SynthraV3.Factory`, `UnitflowV3.Factory`                                                        |
| Algebra pools (Camelot V3, QuickSwap V3) | `uniswapV3` | the registry has the factory's address but not Algebra's `poolByPair(a, b)`: pass the pool in as a `main` input              | `Camelot.V3Factory`, `Quickswap.V3Factory` (addresses only)                                      |
| Uniswap V4                               | `uniswapV4` | no factory: build the key `{ currency0, currency1, fee, tickSpacing, hooks }`, and read its price from `UniswapV4.StateView` | `UniswapV4.PoolManager` (the swap), `UniswapV4.StateView` (the price)                            |

Leave out venues without a price limit (V2-style pairs, Curve, Balancer, DODO, Trader Joe LB,
WOOFi): they fill in full at whatever price. Maverick V2 bounds by tick, not sqrt price.

## Ordering

- **By price** (the reference): the current `sqrtPriceX96` of a V3-style pool is the first word of
  `slot0()` (selector `0x3850c7bd`) on Uniswap V3, PancakeSwap V3, Slipstream, Synthra and UnitFlow,
  and the first word of `globalState()` on Algebra pools. Selling token0 (the input is the lower
  address) moves the price down, so a **higher** sqrtPrice is better; selling token1, a **lower** one
  is. A pool whose price is not better than the limit cannot trade and is skipped.
- **Uniswap V4 pools** are ranked with the others. A hookless pool's id is
  `crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n))`, and
  `const [sqrtPriceX96] = UniswapV4.StateView.getSlot0(poolId);` reads its price. A key with no pool
  reads 0 and is skipped. Keys are built from the pair itself, so a V4 pool in native ETH (currency
  `0x0`) is a different pair and is never touched.
- **By liquidity depth** (an alternative): read each pool's in-range `liquidity()` instead and
  sort deepest first, so the pools that move least per unit absorb the input first. It favours low
  price impact over the best starting price; either key is sound, because the limit bounds every
  fill.
- **The sort**: collect every candidate with its price, then insertion-sort the indexes of those
  priced better than the limit, best first. Each index names a V3-style pool address, or (pool `0`)
  a V4 key's fee and tick spacing.

The core, for Uniswap V3 alone:

```sauce chain=base,arbitrum,optimism
import { uniswapV3 } from "@sauce/router";

function isBetter(price: Uint256, than: Uint256, tokenIn: Address, tokenOut: Address): bool {
  if (tokenIn < tokenOut) {
    return price > than;
  }
  return price < than;
}

function spotPrice(pool: Address): Uint256 {
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
  if (available(UniswapV3.Factory)) {
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      const pool = UniswapV3.Factory.getPool(tokenIn, tokenOut, fee);
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
  for (let i = 0n; i < count; i++) {
    const remaining = Token(tokenIn).balanceOf(self);
    if (remaining > 0n) {
      uniswapV3(pools[i], tokenIn, tokenOut, remaining, sqrtPriceLimitX96, 0n, self);
    }
  }
  Token(tokenOut).transfer(recipient, Token(tokenOut).balanceOf(self) - outBefore);
  Token(tokenIn).transfer(recipient, Token(tokenIn).balanceOf(self));
}
```

## One swap per pool

Each swap is a `@sauce/router` call (`sauce-swaps`), through the Pot's Router, which pays each pool
only what it fills:

- `uniswapV3(pool, tokenIn, tokenOut, remaining, sqrtPriceLimitX96, 0n, self)` for a V3-style pool;
- `uniswapV4(UniswapV4.PoolManager, tokenIn, tokenOut, remaining, fee, tickSpacing, 0n,
sqrtPriceLimitX96, 0n, self)` for a hookless V4 pool, its key built from the two tokens.

The floor is `0n` on each swap and the output stays in the Pot (`self`): the settlement checks the
fill as a whole. Each helper returns the input the pool took (the Pot's input balance before minus
after), and `main` subtracts it from what is still unsold. A ranked pool exists and is priced better
than the limit, so its swap is expected to succeed; a revert reverts the whole program.

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

- **Another chain**: pass its `--chain`; the venues it has are used, and the others left out.
- **Another venue**: add its lookups behind `if (available(<Namespace.Contract>))`; `swapIntoV3`
  (`uniswapV3`) already drives every V3-style pool the Router services. For Algebra pools, read `globalState()`
  for the price.
- **More V4 pools**: add their `(fee, tickSpacing)` keys; a hooked pool needs its `hooks` address
  (in the pool id and the key) and a hook you have reviewed.
- The input must be in the Pot before the program runs: for a direct cook, the Pot's owner funds it
  (or `--fund` pulls it in with the cook); for an intent, the solver delivers it (`sauce-intents`).
  Compile and send it with `sauce-run`.
