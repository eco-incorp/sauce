<!-- Generated from skills/sauce-solana-distributed-swap/SKILL.md for the manual. Edit that file, not this one. -->

# A distributed swap on Solana

**How-to guide** · [Documentation](../README.md)

> The same order on Solana: buy a lot of a token, never paying more than a set price for any of it,
> spread over the pools of several Solana exchanges. Each pool sells what it can below your price,
> and what you have not spent moves on to the next, in one transaction.

The limit order of [the distributed swap](distributed-swap.md), on Solana: one price, the most the caller pays for any
unit, fees included, and every pool trading until its own price reaches it. The method (the price
does the splitting, no sorting, the two checks on the total) is that skill's. This skill owns what
Solana changes: the program finds its pools by key, as an EVM program asks a factory for a pool,
every account a pool takes is read from it as the cook is built, and what fits in one transaction.

## Core model

- **A program for one request.** It names its tokens by symbol (`USDC`, `SPCX_US`), its venues by
  namespace (`Raydium.CLMM`, `Byreal.CLMM`) and its pools by key, written in; the amounts and the
  recipient are `main`'s arguments, passed with `--args`. Another pair, venue or key is an edit to
  the program.
- **Pools are found by key, as on an EVM chain.** `Raydium.CLMM.pool(USDC, SPCX_US, 2500)` is the
  pool Raydium's program keeps for the pair at fee 0.25%, as
  `UniswapV3.Factory.getPool(USDC, WETH, 500)` is Uniswap's at fee 500. The key is each venue's
  own: a tick spacing for Orca, Cropper, DefiTuna and Crema, a fee in millionths for Raydium CLMM,
  PancakeSwap CLMM, Byreal and Stabble. A loop over keys written out
  (`for (const fee of [2500, 1800])`) finds one pool per key. Where a venue keeps two configs at
  one fee (Raydium's and PancakeSwap's 0.01% and 0.05%), the tick spacing follows the fee
  (`Raydium.CLMM.pool(USDC, WSOL, 100, 1)`); the fee alone is refused for a pair with a pool under
  both, naming each. At Orca and Cropper the spacing alone names the pool on the static fee tier,
  and a pool on an adaptive-fee tier is named by the tier's index after the spacing
  (`Orca.Whirlpool.pool(USDC, SPCX_US, 64, 1025)`): an adaptive-fee Orca pool, like a
  Raydium-code pool with a dynamic fee, takes no part at a price.
- **Every account is derived.** A Solana transaction lists every account it touches before it
  runs, so the key must be known when the program compiles, and compiling adds the accounts a swap
  at each pool takes to `main`. The command reads each pool from the cluster as it builds the cook,
  with the Pot's own, so it is given no account. A key with no pool there is an empty slot: its
  accounts are the System program, `11111111111111111111111111111111`, and its swap returns 0.
- **One call per pool.** Each is
  `<Venue>.swap(pool, tokenIn, tokenOut, amountIn, priceLimit, minOut)` ([the `@sauce/router` reference](../api/router.md) gives each
  argument), offered everything still unspent. What it buys
  lands in the Pot's own account for the token bought, and it returns what arrived, `0` for a pool
  it skipped.
- **Each swap stops inside its window.** A venue's swap walks only the tick arrays the cook gives
  it, and past them its program fails the whole cook. So each swap at a price holds its limit a tick
  inside them: a `priceLimit` far past a pool's price buys up to its window and stops there.
- **Each swap stops within its share of the cook's compute.** Every initialized tick a pool's swap
  crosses costs compute units, and a cook that runs out fails whole. So the command works out each
  swap's stop as it builds the cook, from the pool's tick arrays and a cost table of each venue's
  program: the deepest pool walks its whole way first, the next from what is left, a pool what is
  left does not cover is held short of `priceLimit`, and one it cannot pay for is skipped. A wide
  limit then fills less; it never fails the cook for compute. `sauce simulate` and `sauce run`
  check the stops in a simulation, and print a line for each pool a stop held or skipped.
- **About five pools fit one cook's accounts**, the program staged and its accounts in a lookup
  table, and the stops share its compute among those that trade. Keys that find more are refused
  before anything is signed, naming each key's pool.

## The rules

A correct distributed swap on Solana, whatever its tokens or venues:

1. **Finds its pools by key**, and skips a key with no pool.
2. **Skips an empty pool, a pool already past its own limit, one whose fee is not one rate, and a
   remainder of dust.** A venue handed a limit on the wrong side of its price fails the whole cook
   (Raydium's `SqrtPriceLimitOverflow`, Orca's `InvalidSqrtPriceLimitDirection`, Crema's
   `WrongSqrtPriceLimit`), and so do a pool with swaps switched off, a paused pool and a market not
   open: `swap` reads each before calling, so the skips are reads, never failures. A dynamic fee,
   an adaptive fee, or a Byreal pool's decay, imbalance or own fee rate is more than the rate the
   limit is adjusted for, so that pool is skipped rather than pay past `priceLimit`. A remainder
   too small to buy a unit at a pool's price after its fee buys nothing there, so that pool is
   skipped too.
3. **Gives each pool its own limit, adjusted for its fee.** A concentrated-liquidity pool takes its
   fee from the input, so its last unit costs its price divided by `1 − fee`: each pool's limit is
   the caller's sqrt price moved toward the trade by `√(1 − fee)`, **`limit ÷ √(1 − fee)` paying
   the lower-key token, `limit × √(1 − fee)` paying the other**. An order book charges its fee on
   top, so its limit price is `priceLimit ÷ (1 + fee)`. The fee is read from the pool or its config
   in the cook.
4. **Offers each pool everything still unspent** and lets the limit stop it. Every venue here takes
   only what it swapped before its price reached the limit and leaves the rest in the Pot: nothing
   is stranded.
5. **Checks the total**: at least `minTokens` bought, an average no dearer than `maxAvgPrice`.
6. **Sends what was bought and what is left of the budget to `recipient`**, never the rest of what
   the Pot holds.

The order of the pools decides only which pool gets the budget when it runs out first: put the
deepest, cheapest venue first.

## The venues

Every Solana venue the package knows whose swap takes a price limit that stops the swap and leaves
the rest of the input, checked by running each venue's own program, with how a program names its
swap, the key it finds a pool by, and the function of `@sauce/router` that swap is:

| Venue            | Program                                        | Swap                                    | In a program             | Pool by key    | Function          |
| ---------------- | ---------------------------------------------- | --------------------------------------- | ------------------------ | -------------- | ----------------- |
| Raydium CLMM     | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | `swap_v2`, a sqrt price limit           | `Raydium.CLMM.swap`      | fee            | `raydiumClmm`     |
| PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` | the same, on Raydium's code             | `Pancakeswap.CLMM.swap`  | fee            | `pancakeswapClmm` |
| Byreal           | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2`  | the same, on Raydium's code             | `Byreal.CLMM.swap`       | fee            | `byreal`          |
| Stabble CLMM     | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` | the same, on Raydium's code             | `Stabble.CLMM.swap`      | fee            | `stabbleClmm`     |
| Orca Whirlpools  | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`  | `swap_v2`, a sqrt price limit           | `Orca.Whirlpool.swap`    | tick spacing   | `orcaWhirlpool`   |
| Cropper          | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` | `swap` on Orca's code (it has no v2)    | `Cropper.Whirlpool.swap` | tick spacing   | `cropper`         |
| DefiTuna         | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9`  | `swap`, a sqrt price limit              | `Defituna.Fusion.swap`   | tick spacing   | `defituna`        |
| Crema            | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` | `swap`, a sqrt price limit              | `Crema.CLMM.swap`        | tick spacing   | `crema`           |
| Phoenix          | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`  | an immediate-or-cancel order at a price | `Phoenix.Market.swap`    | by its address | `phoenix`         |

Each venue's swap takes the same arguments and refuses a pool of any other venue: a program calls
the venue whose pools it names and carries only that venue's code. A fee is one a config of the
venue charges, in millionths (400 is 0.04%); `sauce pools` prints the key of each pool it lists. A
Phoenix market is not derived from its pair: a program takes it as a `main` argument declared
`Address`.

**Left out**, each for what its program does:

- **Invariant** takes a sqrt price limit, but reaching it with input left fails the swap
  (`PriceLimitReached`) instead of stopping it.
- **Meteora DLMM**: its swap has no limit, and its price-impact swap fails past its bound
  (`ExceededAmountSlippageTolerance`) instead of stopping there.
- **Bonkswap** takes a price limit and fails the swap past it (`PriceLimitExceeded`).
- **Saros DLMM, Meteora DAMM, Raydium CPMM and AMM v4, PumpSwap, the stable and weighted pools, the
  proprietary market makers (HumidiFi, SolFi, Tessera V, Obric, ZeroFi, GoonFi) and Manifest** take
  only a minimum output: they fill in full at whatever price, so they cannot stop at one.

Each venue's pool layout, how its program derives a pool from its key, the nine accounts a swap at
its pool takes and how to list a pair's pools are in [the venues, their pools and their slots](#the-venues-their-pools-and-their-slots).

## The program

`solana-distributed-swap.sauce.ts` is one
complete implementation of those rules, buying SpaceX's tokenized share, `SPCX_US` (a Token-2022
mint), with USDC at the pair's pools that trade at a price: Raydium's at fee 0.25% and 0.18%,
Byreal's at 0.1% and PancakeSwap's at 0.08%; its header gives every input with its units and how to
run it. Each venue's byte layout,
instruction format and account order is `@sauce/router`'s, which every compile the package makes
resolves with no option. Its code:

```ts
// SpaceX for USDC over Solana's pools, as a limit order: up to `budget` USDC, never more than
// `priceLimit` for any SPCX_US, fees included, and at least `minTokens` SPCX_US or nothing. SPCX_US
// is Backpack's SpaceX share, a Token-2022 mint. The pools are found by key, as an EVM program finds
// a Uniswap pool by its fee: Raydium's CLMM pools of the pair at fee 0.25% and 0.18%, Byreal's at
// 0.1% and PancakeSwap's at 0.08%, the pair's pools on mainnet that trade at a price, the deepest
// first; a key with no pool is skipped. Each pool is offered what is left of the budget and trades
// until its price, fee paid, reaches priceLimit. Compiling adds each pool's accounts to main, read
// from the pool when the cook is built, so the command is given no account.
//
//   sauce run solana-distributed-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <budget> <priceLimit> <minTokens> <maxAvgPrice> <recipient>
//
//   budget: Uint256       the most USDC to spend, in its base units: 1000000000 is 1,000 USDC; it
//                         must be in the Pot's USDC account
//   priceLimit: Uint256   the most one SPCX_US may cost, fees included: USDC base units per SPCX_US
//                         base unit, times 10^18; both have 6 decimals, so 150 USDC a share is
//                         150000000000000000000
//   minTokens: Uint256    the least SPCX_US to buy, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in priceLimit's units; 0 turns it off
//   recipient: Address    receives the SPCX_US bought and the USDC left unspent
//
//   All of 1,000 USDC or nothing, at most 150 USDC a share, simulated with no key:
//   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
//     --assume-balance USDC:1000 --args 1000000000 150000000000000000000 6666667 0 <recipient>

// Each pool is found by its key: `Raydium.CLMM.pool(USDC, SPCX_US, 2500)` is the pool Raydium's
// program keeps for the pair at fee 0.25%, and a loop over keys finds one pool for each. Each swap
// is `@sauce/router`'s at that venue: it returns 0 having moved nothing for a key with no pool, a
// spent budget, an empty or past-limit pool and one whose fee is not one rate, else offers the pool
// the amount it is given up to its own fee-adjusted limit, and returns what arrived in the Pot.
function main(
  budget: Uint256,
  priceLimit: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  require(self.USDC >= budget, "budget is not in the Pot");
  const kept = self.USDC - budget; // the Pot's other USDC, never spent

  // Each pool in turn, offered what is left of the budget.
  let bought = 0;
  for (const fee of [2500, 1800]) {
    bought += Raydium.CLMM.swap(
      Raydium.CLMM.pool(USDC, SPCX_US, fee),
      USDC,
      SPCX_US,
      self.USDC - kept,
      priceLimit,
      0,
    );
  }
  bought += Byreal.CLMM.swap(
    Byreal.CLMM.pool(USDC, SPCX_US, 1000),
    USDC,
    SPCX_US,
    self.USDC - kept,
    priceLimit,
    0,
  );
  bought += Pancakeswap.CLMM.swap(
    Pancakeswap.CLMM.pool(USDC, SPCX_US, 800),
    USDC,
    SPCX_US,
    self.USDC - kept,
    priceLimit,
    0,
  );

  const unspent = self.USDC - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  // The SPCX_US bought and what is left of the budget both go to the recipient.
  if (bought > 0) SPCX_US.transfer(recipient, bought);
  if (unspent > 0) USDC.transfer(recipient, unspent);
  return { spent, bought, unspent };
}
```

- **Inputs.** The amounts (`budget`, `priceLimit`, `minTokens`, `maxAvgPrice`) and who gets what
  was bought (`recipient`) are `main`'s arguments, passed with `--args`. The tokens, the venues and
  the keys are written in.
- **The accounts are derived.** Compiling adds every account the program uses to `main`, each with
  how it is derived (`sauce compile --json` lists them): each key's nine, read from the pool it
  finds for the token paid (its tick arrays depend on the direction); the Pot, its accounts for
  the two tokens and the two mints; the token programs and the memo program; and the recipient's
  accounts. The command fills every one, so it is given none. SPCX_US's accounts are Token-2022's,
  which the command derives from the mint's program; the swaps and the transfer of a Token-2022
  token take the mint too.
- **The paying side.** Through the Kitchen the program acts as the Pot: the budget is in the Pot's
  USDC account, what is bought lands in its SPCX_US account, and `self.USDC` is the Pot's USDC
  balance. `kept` is whatever else of it the Pot holds, so only the budget is ever offered.
- **Each pool** is offered all of the budget still unspent, `self.USDC - kept`, with a floor of
  `0`: the totals are checked once, after the pools.
- **`swap`** returns `0` at once for a key with no pool or a spent budget. A concentrated-liquidity
  pool: it skips one whose fee is more than one rate or whose swaps are off, reads the mints and
  requires the pair, reads the liquidity, price and fee, works out the pool's own limit, skips an
  empty pool, one not better than that limit and an amount too small to buy a unit at its price
  after its fee, and swaps everything offered up to it. Its price is the square root of the
  higher-key token per lower-key token, times 2^64 (the pair in the order of their 32-byte keys), so
  `priceLimit` as that price is `√(priceLimit × 2^128 ÷ 1e18)` paying the higher-key token and,
  upside down, `√(2^128 × 1e18 ÷ priceLimit)` paying the lower-key one, before the fee moves it; the
  root is rounded down, so the pool stops a little sooner, never later.
- **Settle.** A `require` reverts the whole cook, every swap included. What was bought goes from
  the Pot to the recipient's SPCX_US account, and what is left of the budget to the recipient's USDC
  account; given the Pot's own address (`sauce pot --chain solana --owner <owner>` prints it), both
  stay in the Pot. Each transfer is checked: the account it pays must be the recipient's own.
  `main` returns `{ spent, bought, unspent }`, which `sauce simulate` prints by name.

**Other pools.** Each venue is one loop over its keys, or one call with its key written in. A venue
is one more loop or call of the same shape after the others, its namespace and keys in Raydium's or
Byreal's place, and a key is one more in its list. Another pair is the symbols in every call and in
`self.USDC`. The keys here are chosen for SPCX_US/USDC: `sauce pools` gives another pair's. Keep to
what fits in one cook (below).

## Inputs and units

`main`'s arguments, in order: `budget`, `priceLimit`, `minTokens`, `maxAvgPrice` and `recipient`,
every amount in a token's base units. `recipient` is a wallet, paid what was bought into its own
SPCX_US account and what is left of the budget into its own USDC account, or the Pot's own address
to keep both in the Pot.

On Solana USDC and SPCX_US both have 6 decimals, so `1000000000` is 1,000 USDC and also 1,000
SPCX_US; SOL has 9, and a pool holds it wrapped, the mint the registry names `WSOL` (`sauce pools`
takes `SOL` for it too). Selling one token for another is buying the other with it: a program
selling SPCX_US for USDC pays SPCX_US and buys USDC.

**`priceLimit`** is payToken base units per buyToken base unit, times 1e18:
`priceLimit = price × 10^(18 + payDecimals − buyDecimals)`, with `price` in whole payToken per
whole buyToken. Paying USDC (6) for SPCX_US (6), that is the price × 10^18.

| Trade                                           | Price                        | `priceLimit`              |
| ----------------------------------------------- | ---------------------------- | ------------------------- |
| Buy SPCX_US with USDC                           | at most 150 USDC             | **150000000000000000000** |
| Buy SPCX_US with USDC, at a floor               | at least 0.0068 SPCX_US each | **147058823529411764705** |
| Buy USDC with SPCX_US (sell SPCX_US at a floor) | at least 140 USDC            | **7142857142857142**      |

**A floor is a ceiling turned over.** `priceLimit` is always what one unit bought may cost, in the
token paid. A limit given as the least bought per unit paid ("never below 0.0068 SPCX_US per
USDC") is its inverse, `priceLimit = 10^(18 + payDecimals − buyDecimals) ÷ floor`, rounded down so
no unit fills below the floor: paying USDC for SPCX_US at 0.0068, `10^18 ÷ 0.0068`, 147.058823
USDC per SPCX_US. The third row is the same: 1 SPCX_US for at least 140 USDC is at most `1 ÷ 140`
SPCX_US per USDC, so `10^6 × 1e18 ÷ (140 × 10^6)`, rounded down.

**`minTokens`** is `budget × 1e18 ÷ priceLimit`, rounded up, to spend all of the budget or nothing:
buying SPCX_US with 1,000 USDC at most 150, `6666667` (6.666667 SPCX_US); less (or `0`) to take
what fills within `priceLimit` and send the rest of the budget to the recipient.

**`maxAvgPrice`**, in `priceLimit`'s units (`0` off), is halfway from a simulation's average
(`spent × 1e18 ÷ bought`) to `priceLimit`, rounded up: a simulation averaging 149.5 USDC per
SPCX_US with `priceLimit` 150 gives 149.75, **149750000000000000000**.

**The reference price** is the best a buyer pays, fee included, among pools deep enough for the
order: a pool's price divided by `1 − fee` paying the higher-key token, the same upside down paying
the other. `priceLimit` is that plus the slippage you accept, kept tight: a limit far past every
pool's price, with a budget to reach it, walks the deepest pool across so many initialized ticks
that the others are held short or skipped to keep the cook within its compute (the simulation's
lines say which). Solana's pool prices
differ between venues more than an EVM chain's: a thin pool can sit a percent or two from the deep
ones, and an order book's offers further still. A `priceLimit` at or below the best price trades
nothing and sends the whole budget to the recipient, without reverting.

## What fits in one cook

A cook is one Solana transaction: at most 1,232 bytes and 64 accounts, and 1,400,000 compute units.

- **The program is staged.** It is about 6.0 KB, past one transaction, so it runs from a code
  buffer it is written into first; `sauce run` does that ([Solana](solana.md)).
- **The accounts go through a lookup table.** The program names 46 accounts, every one derived: nine
  for each key, the Pot's, the mints', the programs' and the recipient's two. A key with no pool
  names the System program nine times, one account; each pool found brings eight of its own. The
  cook names each account once; listed in the transaction they would be past its size, and through
  an address lookup table they are one byte each.
- **About five pools fit.** Keys that find five pools, the Pot's and the recipient's accounts and
  the cook's own come to about 60 accounts of 64. Keys that find more are refused before anything is
  signed: the command names the pool each key found
  (`Raydium.CLMM.pool(USDC, SPCX_US, 2500) is <pool>`, `… finds none`), so drop the keys you want
  least. Measured on the venues' own programs, buying SPCX_US: three pools that trade and a key with none take about 1,140,000 of the 1,400,000 compute units, a token moved under Token-2022 costing
  more than one under SPL Token. Pools that share a program or a config cost fewer accounts.

## Running it

Three steps, each a `sauce` command, every input on `--args`. Every amount is base units but the
command's token amounts: `--assume-balance USDC:1000` is 1,000 USDC in whole tokens
(`USDC:1000000000n`, with a trailing `n`, the same in base units).

1. **Choose the keys.** `sauce pools --chain solana USDC SPCX_US --json` reads every pool of the
   pair at the venues above, deepest first, each with its `venue`, `pool`, `byKey` (how a program
   finds it: `Raydium.CLMM.pool(USDC, SPCX_US, 2500)`), `fee`, `liquidity`, and its price both ways with the
   fee (`sides[].taker`, and as `priceLimit`). A pool the program would skip is under `skipped`,
   with `why`; `checked` names each venue read. A venue that could not be read (an endpoint
   refusing the scan) leaves the listing partial, said in a note, and the command exits 1: run it
   again, or give an endpoint that answers `getProgramAccounts`. Put the keys of the deepest pools
   whose price is within the limit in the program's lists, the deepest venue first.

   ```sh
   sauce pools --chain solana USDC SPCX_US --json
   ```

   A pool deep enough may take the whole order, and the pools after it then trade nothing: that is
   the program spending within the limit, not a pool wasted.

2. **Simulate**, with no key and nothing sent. The cook is past one transaction, so
   `sauce simulate` runs it in a local copy of every account it names, read from the cluster, with
   the released engine and Kitchen ([Solana](solana.md)): `--owner` is any wallet's address, or any
   address with no account, never a program's account such as a pool or a mint;
   `--assume-balance` gives the Pot's USDC account the budget in that copy. `<recipient>` is a
   wallet, or the Pot's address. The program file is the example's, in the project (or run where
   the skill is installed):

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --assume-balance USDC:1000 --args 1000000000 150000000000000000000 0 0 <recipient>
   ```

   Simulate once with `minTokens` and `maxAvgPrice` 0 to read what fills and its average, once with
   `minTokens` above what filled, once with `maxAvgPrice` below the average; then set them by the
   rules above. A simulation that reverts exits 1, its first line `The cook reverts: <reason>`, so
   hold each guard to its revert with `--expect-revert`, which exits 0 only when the cook reverts
   with that reason:

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --assume-balance USDC:1000 --args 1000000000 150000000000000000000 6666667 0 <recipient> \
     --expect-revert "bought below minTokens"
   ```

   and `--expect-revert "average too high"` for the average. Over MCP, `sauce_simulate`'s
   `scenarios`, each with its own `expectRevert`, simulate all three in local copies of one read of
   the cluster, at one slot. A token account the cluster does not have yet, such as a new Pot's
   SPCX_US account or the recipient's, the copy makes empty and a note names; `sauce run` creates it
   before the cook.

3. **Send** with `sauce run`, signed by the owner's `--keypair` (or `--wallet`), the budget already
   in the Pot's USDC account (a transfer into it from any wallet). `sauce run` creates the Pot and
   the token accounts the cook names that do not exist yet, the Pot's SPCX_US account and the
   recipient's SPCX_US and USDC accounts, each under its mint's token program (asking first, or
   with `--yes`; the owner pays their rent),
   stages the program in a code buffer, creates an address lookup table holding the cook's accounts
   (it prints its address; a later cook naming the same accounts reuses it with
   `--lookup-table <address>`), simulates the staged cook, sends it, and closes the buffer:

   ```sh
   sauce run solana-distributed-swap.sauce.ts --chain solana --keypair <keypair> \
     --args 1000000000 150000000000000000000 6666667 149750000000000000000 <recipient>
   ```

   For another signer, `sauce tx` prints the cook as a plan of steps (setup, cook, the buffer's
   close) for `sauce send … --cursor <cursor>` ([Solana](solana.md)).

**Reading a simulation.** **A simulation counts only when it succeeds and `bought` is above 0**:
anything else (a failure, a revert, nothing bought) is a failed simulation to fix and run again,
never a result. Buying SPCX_US with 2,000 USDC, Raydium's 0.25% pool deep enough for all of it, the
addresses as placeholders:

```text
The cook succeeds from <owner>: 545182 compute units, returns <the same three words, in hex>
main returns { spent: Uint256; bought: Uint256; unspent: Uint256 }: { spent: 2000000000, bought: 13618205, unspent: 0 }
Simulated in a local copy (LiteSVM) of the 34 accounts the cook names, read from solana at slot <slot>, with the released engine and Kitchen: the cook does not fit one transaction, and no cluster can stage a program without sending. Nothing was signed or sent:
  the 6255-byte program staged into a code buffer in 9 transactions, as `sauce run` stages it
  the cook from that buffer, from the owner <owner>, which pays the Kitchen's execution fee of <fee> lamports
Token balance changes:
  <account> (potUSDC, the Pot's USDC account), owned by <Pot> (the Pot): -2000 USDC
  <vault> (raydiumClmm2500VaultA, pool <pool>'s vaultA, paying USDC), owned by <pool> (raydiumClmm2500Account, …): -13.618205 SPCX_US
  <vault> (raydiumClmm2500VaultB, pool <pool>'s vaultB, paying USDC), owned by <pool> (raydiumClmm2500Account, …): +2000 USDC
  <account> (recipientSPCX_US, main's argument recipient's SPCX_US account), owned by <recipient>: +13.618205 SPCX_US
```

- **`main returns`** names the three values: 2,000 USDC spent, 13.618205 SPCX_US bought, nothing
  unspent; the average, `spent × 1e18 ÷ bought`, is **146862233311952639867**, 146.86 USDC per
  SPCX_US.
- **Each pool that traded** shows its two vaults, named for its venue and key. A key you gave and
  do not see sat out: no pool there, empty, skipped, past its limit, or the budget ran out first.
- **A partial fill** sends what is left of the budget from the Pot's USDC account to the
  recipient's.

## Pitfalls

- **A pool's address in the program.** Name the venue and the key; the address is the venue's to
  derive, and the command reads the pool from it.
- **A key computed as the program runs.** A key is written out, or a loop's variable over keys
  written out: the accounts are derived before the cook runs.
- **A token account as `recipient`.** It is the wallet paid: the cook pays that wallet's own
  account for the token. A token account given there is taken as a wallet, and the cook pays an
  account it holds, which no one can spend from.
- **The budget not in the Pot.** It must be in the Pot's USDC account when the cook runs
  (`budget is not in the Pot` otherwise); a simulation gives it with `--assume-balance`.
- **A simulation that bought nothing taken as a result.** Only a success with `bought` above 0
  counts.
- **`priceLimit` given as a floor.** Turn a least-bought-per-unit limit over:
  `10^(18 + payDecimals − buyDecimals) ÷ floor`, rounded down.
- **Keys that find more pools than fit.** About five; the command refuses more, naming each key's
  pool.
- **A `priceLimit` far past every price, with a large budget.** The deepest pool walks first and
  the rest share what compute is left: a later pool is held short or skipped, and the simulation's
  `… stops at …` and `… is skipped` lines name it. Keep the limit tight, and simulate.
- **A program's account as `--owner`** (a pool, a mint). The owner signs and pays: a wallet, or an
  address with no account.

## The venues, their pools and their slots

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

### Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble CLMM

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

### Orca Whirlpools and Cropper

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

### DefiTuna

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

### Crema

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

### Phoenix

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

### A pool by its key

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

### Listing a pair's pools

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
