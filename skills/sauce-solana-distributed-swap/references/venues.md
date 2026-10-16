# The venues, their pools and their slots

Every venue the distributed swap trades on, with its swap in a program and its function in
`@sauce/router`, where its pool keeps what that function reads, the nine accounts a swap at the
pool takes (its slot), and how to find a pair's pools. A program never names these accounts:
compiling it adds them for each pool it is given, and the command reads them from the pool as it
builds the cook. Offsets are bytes from the start of the account; integers are little-endian, keys
32 bytes. A slot's accounts are, in order:

| #   | Slot account | What it is                                                              |
| --- | ------------ | ----------------------------------------------------------------------- |
| 0   | `program`    | the venue's program, which must own the pool                            |
| 1   | `pool`       | the pool (a market, on Phoenix)                                         |
| 2   | `config`     | the account the venue keeps the pool's settings in, where it has one    |
| 3   | `vaultA`     | the pool's vault for its first token (token 0, token A, Phoenix's base) |
| 4   | `vaultB`     | the pool's vault for its second token                                   |
| 5   | `extra`      | one more account the venue's swap takes                                 |
| 6–8 | `ticks`      | the three tick arrays the swap walks, in walk order (bin arrays, DLMM)  |

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
other way, or with arrays holding no liquidity, which the swap loads and never walks into. A pool
whose price is far from 1 may also need its bitmap extension, the program address of
`["pool_tick_array_bitmap_extension", pool]`, in one of the three.

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

## Meteora DLMM

Bins instead of ticks: a pool of 904 bytes (`Meteora.DLMM.swap`, `meteoraDlmm`). Each bin holds two
amounts at one fixed price, `(1 + binStep ÷ 10,000)^id` token Y per token X, its id an i32; 70 bins
make a bin array. Its swap takes no price limit: `meteoraDlmm` walks the bins itself, from the
active one in the trade's direction, and offers the swap exactly what drains every bin within
`maxPrice`, its fee included, so the swap stops with the last of them drained. It walks at most
eight bins.

| Read                                              | Where                                                   |
| ------------------------------------------------- | ------------------------------------------------------- |
| base factor, filter and decay periods, reduction  | 8, 10, 12, 14 (u16)                                     |
| variable fee control, most volatility             | 16 and 20 (u32)                                         |
| base fee power factor                             | 34                                                      |
| fee taken from the token bought                   | 36; not zero means so, and the pool is skipped          |
| volatility, its floor, reference bin, last update | 40, 44 (u32), 48 (i32), 56 (i64)                        |
| active bin, bin step, status                      | 76 (i32), 80 (u16), 82; status not zero means swaps off |
| activation type, activation point                 | 86 (0 a slot, 1 a time), 816 (u64); before it, skipped  |
| mint X, mint Y                                    | 88 and 120, the pool's own order, not the keys'         |
| reserve X, reserve Y                              | 152 and 184                                             |
| oracle                                            | 552                                                     |
| bin-array bitmap                                  | 584, 1,024 bits: bit `i` is the bin array `i − 512`     |
| a bin array's index; bin `k`'s X, Y and price     | 8 (i64); 56 + 144 × `k`: u64, u64, u128 (Q64.64)        |

The fee, in billionths of the input: `base factor × bin step × 10 × 10^power`, plus
`(volatility × bin step)² × control ÷ 10^11`, rounded up, at most a tenth. A bin's volatility is
the floor plus 10,000 for each bin between it and the reference, at most the pool's most; at the
swap's start, past the filter period since the last update the reference is the active bin and the
floor the volatility times the reduction over 10,000, and past the decay period the floor is 0.

The slot: `config` = the event authority, the program address of `["__event_authority"]` under the
DLMM program; `vaultA`/`vaultB` = reserve X and reserve Y; `extra` = the oracle; `ticks0` and
`ticks1` = the two bin arrays the bitmap marks nearest the active bin's, that one included, in the
walk's direction (down paying token X, up paying token Y), and `ticks2` = the System program. A bin
array is the program address of `["bin_array", pool, index]`, `index` a little-endian i64. Its swap
is `swap` on the first two for two SPL Token mints, and `swap2` on the first for a Token-2022 mint.
A pool whose active bin is past the 1,024 arrays of its bitmap needs its bitmap extension, which the
slot does not carry: it is skipped.

## Finding a pair's pools

A venue's pools are its program's accounts, so `getProgramAccounts` on the venue's program finds
them, with the pool's size and the pair at its mints' offsets as filters: for the
concentrated-liquidity venues the lower key at the first offset and the higher at the second, for
Phoenix the base and quote and for Meteora DLMM its X and Y, in either order. Then read each pool's liquidity, price and fee at the
offsets above, drop the empty ones and those whose fee is more than one rate, and keep the deepest
and cheapest. `sauce pools` does all of this, and `--pay` gives the pools chosen in slot order.

| Venue                                      | Size  | First mint | Second mint |
| ------------------------------------------ | ----- | ---------- | ----------- |
| Raydium CLMM, PancakeSwap, Byreal, Stabble | 1,544 | 73         | 105         |
| Orca Whirlpools, Cropper                   | 653   | 101        | 181         |
| DefiTuna                                   | 423   | 11         | 43          |
| Crema                                      | 748   | 40         | 72          |
| Phoenix (base, quote)                      | any   | 48         | 128         |
| Meteora DLMM (X, Y)                        | 904   | 88         | 120         |

A pool's price, back in whole tokens: `(sqrtPrice ÷ 2^64)^2 × 10^(lowerDecimals − higherDecimals)`
higher-key tokens per lower-key token. Paying the higher-key token, its price fee included is that
divided by `1 − fee`; paying the lower-key token, `1 ÷ (price × (1 − fee))`. A DLMM pool's, at
its active bin: `(1 + binStep ÷ 10,000)^active × 10^(xDecimals − yDecimals)` token Y per token X;
paying Y, its price fee included is that divided by `1 − fee`, and paying X, `1 ÷ (price × (1 − fee))`.
