# The venues, their pools and their slots

Every venue the distributed swap trades on, with its swap in a program and its function in
`@sauce/router`, where its pool keeps what that function reads, how its program derives a pool
from its key, the nine accounts a swap at the pool takes (its slot), and how to list a pair's
pools. A program never names these accounts: compiling it adds them for each pool it names, and
the command reads them from the pool as it builds the cook. Offsets are bytes from the start of the account; integers are little-endian, keys
32 bytes. A slot's accounts are, in order:

| #   | Slot account | What it is                                                              |
| --- | ------------ | ----------------------------------------------------------------------- |
| 0   | `program`    | the venue's program, which must own the pool                            |
| 1   | `pool`       | the pool (a market, on Phoenix)                                         |
| 2   | `config`     | the account the venue keeps the pool's settings in, where it has one    |
| 3   | `vaultA`     | the pool's vault for its first token (token 0, token A, Phoenix's base) |
| 4   | `vaultB`     | the pool's vault for its second token                                   |
| 5   | `extra`      | one more account the venue's swap takes                                 |
| 6–8 | `ticks`      | the three tick arrays the swap walks, in walk order                     |

An account a venue does not take is the System program, `11111111111111111111111111111111`, and so
is every account of an empty slot. The concentrated-liquidity venues keep the pair in the order of
the two mints' 32-byte keys, the lower first: paying the lower-key token pushes the price down,
paying the other pushes it up, and the tick arrays the swap walks depend on which.

## Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble CLMM

One pool layout (1,544 bytes) and one swap, `swap_v2`, on four programs: `Raydium.CLMM.swap`,
`Pancakeswap.CLMM.swap`, `Byreal.CLMM.swap` and `Stabble.CLMM.swap` (`raydiumClmm`,
`pancakeswapClmm`, `byreal` and `stabbleClmm`).

| Read                                    | Where                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| lower and higher mint                   | 73 and 105                                                                        |
| vaults (token 0, token 1)               | 137 and 169                                                                       |
| observation account                     | 201                                                                               |
| config (`AmmConfig`)                    | 9; its fee rate, in millionths, at 47 of that account                             |
| liquidity, sqrt price (Q64.64), tick    | 237 (u128), 253 (u128), 269 (i32)                                                 |
| status                                  | 389; bit 4 set means swaps are off                                                |
| Byreal's own fee rate                   | 393 (u32); not zero means more than the config's rate                             |
| Byreal's decay, imbalance, dynamic fees | 1096 to 1112; not all zero means more than one rate                               |
| tick-array bitmap                       | 904, 1,024 bits: bit `i` is the array starting at tick `(i − 512) × 60 × spacing` |

The slot: `config` = the `AmmConfig`, `vaultA`/`vaultB` = the two vaults, `extra` = the
observation account. The tick arrays: the pool's arrays that hold liquidity (their bit set in the
bitmap), from the one holding the price, or the next one past it, in the walk's direction: lower
starts paying the lower-key token, higher starts paying the other. An array is the program address
of `["tick_array", pool, start]` under the venue's program, `start` as a big-endian i32, and spans
60 ticks times the pool's tick spacing. **This swap loads every account given as a tick array**, so
all three must exist: a pool with fewer than three that way fills the rest with its arrays the
other way, or with arrays holding no liquidity, which the swap loads and never walks into.

The pool's own bitmap reaches 512 arrays each way from tick 0. A pool priced past that (tick
spacing 1 and a price past tick ±30,720: PancakeSwap's SPCX_US/USDC pool, near tick 49,800) keeps
its arrays' bits in its bitmap extension, the program address of
`["pool_tick_array_bitmap_extension", pool]`: from 40, 14 bitmaps of 512 arrays (64 bytes each)
past the pool's own, upward; from 936, the same downward. Bitmap `k` holds the array starting at
`(512 × (k + 1) + i) × 60 × spacing` at bit `i` upward, and the array starting at
`−(512 × (k + 1) + 512 − i) × 60 × spacing` at bit `i` downward (bit 0 the lowest start, at a whole
multiple of 512 arrays). Its swap takes the extension wherever it is among the tick arrays, and
without it fails the whole transaction (`MissingTickArrayBitmapExtensionAccount`), so the slot of
such a pool is the extension in the first place, then its two nearest arrays that hold liquidity.

## Orca Whirlpools and Cropper

One pool layout (653 bytes): Orca's `swap_v2` (`Orca.Whirlpool.swap`, `orcaWhirlpool`), and
Cropper's `swap`, the same without Token-2022 (`Cropper.Whirlpool.swap`, `cropper`).

| Read                                 | Where                                            |
| ------------------------------------ | ------------------------------------------------ |
| tick spacing, fee tier               | 41 and 43 (u16); different means an adaptive fee |
| fee rate, in millionths              | 45 (u16)                                         |
| liquidity, sqrt price (Q64.64), tick | 49 (u128), 65 (u128), 81 (i32)                   |
| mint A and its vault                 | 101 and 133                                      |
| mint B and its vault                 | 181 and 213                                      |

The slot: `config` = the System program, `vaultA`/`vaultB` = the two vaults, `extra` = the oracle,
the program address of `["oracle", pool]` (it need not exist). The tick arrays: the program address
of `["tick_array", pool, start]`, `start` written out as decimal text, each spanning 88 ticks times
the spacing; the array holding the price and the next two in the walk's direction. Orca takes
arrays that do not exist yet as empty; Cropper needs every array its walk reaches to exist.

## DefiTuna

A pool of 423 bytes, a whirlpool's fields in another order, and its `swap`
(`Defituna.Fusion.swap`, `defituna`):

| Read                                 | Where                             |
| ------------------------------------ | --------------------------------- |
| mint A, mint B                       | 11 and 43                         |
| vault A, vault B                     | 75 and 107                        |
| tick spacing, fee rate (millionths)  | 139 and 143 (u16)                 |
| liquidity, sqrt price (Q64.64), tick | 151 (u128), 167 (u128), 183 (i32) |

The slot: `config` and `extra` = the System program, `vaultA`/`vaultB` = the two vaults; the tick
arrays as a whirlpool's, under DefiTuna's program. Its pools hold resting limit orders too, which a
swap fills at their tick's price: within the limit, like the rest.

## Crema

A pool of 748 bytes and its `swap` (`Crema.CLMM.swap`, `crema`):

| Read                                 | Where                             |
| ------------------------------------ | --------------------------------- |
| config (`clmm_config`)               | 8                                 |
| mint A, mint B                       | 40 and 72                         |
| vault A, vault B                     | 104 and 136                       |
| tick spacing, fee rate (millionths)  | 168 and 172 (u16)                 |
| liquidity, sqrt price (Q64.64), tick | 174 (u128), 190 (u128), 206 (i32) |
| paused                               | 747; not zero means paused        |

The slot: `config` = the `clmm_config`, `vaultA`/`vaultB` = the two vaults, `extra` = the tick-array
map, the program address of `["tick_array_map", pool]`. The tick arrays: the program address of
`["tick_array", pool, index]`, `index` a little-endian u16, each spanning 64 ticks times the
spacing; the array holding the price and the next two **allocated** ones in the walk's direction,
as the map's bitmap marks them (array 0 starts at tick `−443636 + (443636 mod spacing)`).

## Phoenix

An order book (`Phoenix.Market.swap`, `phoenix`): a market account (its size varies with the
book's) whose header holds:

| Read                                                           | Where         |
| -------------------------------------------------------------- | ------------- |
| status (1: open for taking)                                    | 8 (u64)       |
| base mint, its vault, its lot size                             | 48, 80, 112   |
| quote mint, its vault, its lot size                            | 128, 160, 192 |
| base lots per base unit, tick size in quote lots per base unit | 832 and 840   |
| taker fee, in basis points                                     | 856 (u64)     |

The slot: `config` = the log authority, the program address of `["log"]` under Phoenix's program,
`vaultA`/`vaultB` = the base and quote vaults, `extra` and the tick arrays = the System program.
Base and quote are not in key order: the program reads which one it pays. The order it places is
immediate-or-cancel at the limit price: it takes every offer at or better than the limit, leaves
the rest on the book, and fills nothing when the best offer is past the limit.

## A pool by its key

A program names a pool as `<Venue>.pool(tokenA, tokenB, key)`: the program address its venue's
program derives from the pair, the lower key first whichever way it is written, and the key. The
command derives it as it builds the cook and reads the pool there; no pool there is an empty slot.

| Venue                                      | Key                    | Seeds                                                                                                                             |
| ------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Orca Whirlpools                            | tick spacing           | `"whirlpool"`, the WhirlpoolsConfig `2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ`, lower, higher, the fee tier's index (u16, LE) |
| Cropper                                    | tick spacing           | `"whirlpool"`, the WhirlpoolsConfig `2CmCWqXhw7f3jCnvJg74t4vsm62DTUbKQPWL7NX8oCpL`, lower, higher, the fee tier's index (u16, LE) |
| DefiTuna                                   | tick spacing (u16, LE) | `"fusion_pool"`, lower, higher, key                                                                                               |
| Crema                                      | tick spacing (u16, LE) | `"clmmpool"`, the config `2rUWTKPfLnWDsEajZymGmZAEz8XcsTdo9gzKJfhsmpox`, lower, higher, key                                       |
| Raydium CLMM, PancakeSwap, Byreal, Stabble | fee, in millionths     | `"pool"`, the `AmmConfig` charging that fee, lower, higher                                                                        |

A whirlpool's seed is its fee tier's index, at 43 of the pool: a static tier's index is its tick
spacing, an adaptive-fee tier's another number (1024 and up). Each tier is the program's account
at `["fee_tier", WhirlpoolsConfig, index]` (a little-endian u16), its tick spacing at 40 of a
static tier and at 42 of an adaptive one. A program names the tick spacing, and the SDK knows
every tier of each venue: the spacing alone derives the pool on its static tier; a pool on an adaptive
tier is named by the tier's index after the spacing (`Orca.Whirlpool.pool(SPCX_US, USDC, 64, 1025)`),
and the swap at a price skips it, an adaptive fee being more than one rate. A Raydium-code program keeps
its `AmmConfig`s at the program address of `["amm_config", index]` (a big-endian u16), each one's
fee at 47 and tick spacing at 51 of that account: the program names the fee, and the SDK knows
every config of each venue. Some fees have two configs, at different tick spacings (Raydium's and
PancakeSwap's 0.01% and 0.05%): the fee then names a pool under each, the command takes the one
there, and refuses the fee alone where both are, naming each, for the spacing to follow the fee
(`Raydium.CLMM.pool(USDC, WSOL, 100, 1)`).

## Listing a pair's pools

A venue's pools are its program's accounts, so `getProgramAccounts` on the venue's program finds
them, with the pool's size and the pair at its mints' offsets as filters: for the
concentrated-liquidity venues the lower key at the first offset and the higher at the second, for
Phoenix the base and quote in either order. Then read each pool's liquidity, price and fee at the
offsets above, drop the empty ones and those whose fee is more than one rate, and keep the deepest
and cheapest. `sauce pools` does all of this, and gives each pool's `byKey`: how a program finds it.

| Venue                                      | Size  | First mint | Second mint |
| ------------------------------------------ | ----- | ---------- | ----------- |
| Raydium CLMM, PancakeSwap, Byreal, Stabble | 1,544 | 73         | 105         |
| Orca Whirlpools, Cropper                   | 653   | 101        | 181         |
| DefiTuna                                   | 423   | 11         | 43          |
| Crema                                      | 748   | 40         | 72          |
| Phoenix (base, quote)                      | any   | 48         | 128         |

A pool's price, back in whole tokens: `(sqrtPrice ÷ 2^64)^2 × 10^(lowerDecimals − higherDecimals)`
higher-key tokens per lower-key token. Paying the higher-key token, its price fee included is that
divided by `1 − fee`; paying the lower-key token, `1 ÷ (price × (1 − fee))`.
