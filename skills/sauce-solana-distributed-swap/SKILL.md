---
name: sauce-solana-distributed-swap
description: A Sauce program for Solana that spreads one exact-input swap over several price-limited pools as a limit order, never paying more than a price limit for any unit, fees included, and never stranding input. A program for one request (tokens by symbol, venues by namespace, pools found by key with Orca.Whirlpool.pool(USDC, WSOL, spacing) and Raydium.CLMM.pool(USDC, WSOL, fee) in loops over the keys, as an EVM program loops over fee tiers; a key with no pool skipped), every account derived as the cook is built, the venues whose swap stops at a price limit (Raydium CLMM, PancakeSwap CLMM, Byreal, Stabble CLMM, Orca Whirlpools, Cropper, DefiTuna, Crema, Phoenix) and those left out, priceLimit, minTokens and maxAvgPrice, choosing keys with sauce pools, what fits in one cook, and running it with --args alone. Use when asked for a distributed, split or multi-venue swap on Solana, "swap across Raydium and Orca", "buy SOL up to a price", a limit order, or one trade routed through several Solana pools.
---

# A distributed swap on Solana

The limit order of `sauce-distributed-swap`, on Solana: one price, the most the caller pays for any
unit, fees included, and every pool trading until its own price reaches it. The method (the price
does the splitting, no sorting, the two checks on the total) is that skill's. This skill owns what
Solana changes: the program finds its pools by key, as an EVM program asks a factory for a pool,
every account a pool takes is read from it as the cook is built, and what fits in one transaction.

## When to use

| Task                                                  | Here                    | Elsewhere                                                                    |
| ----------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| Buy or sell up to a price across several Solana pools | yes                     |                                                                              |
| Find a pair's pools and the key each is found by      | yes, with `sauce pools` |                                                                              |
| One swap at one Solana pool                           |                         | `sauce-swaps` (`Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), …)`) |
| The method and its arithmetic in depth                |                         | `sauce-distributed-swap`                                                     |
| Accounts, staging, simulation in a local copy, plans  |                         | `sauce-solana`                                                               |

## Core model

- **A program for one request.** It names its tokens by symbol (`USDC`, `WSOL`), its venues by
  namespace (`Orca.Whirlpool`, `Raydium.CLMM`) and its pools by key, written in; the amounts and
  the recipient are `main`'s arguments, passed with `--args`. Another pair, venue or key is an edit
  to the program.
- **Pools are found by key, as on an EVM chain.** `Orca.Whirlpool.pool(USDC, WSOL, 4)` is the pool
  Orca's program keeps for the pair at tick spacing 4, as `UniswapV3.Factory.getPool(USDC, WETH,
500)` is Uniswap's at fee 500. The key is each venue's own: a tick spacing for Orca, Cropper,
  DefiTuna and Crema, a fee in millionths for Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble.
  A loop over keys written out (`for (const spacing of [1, 4, 64])`) finds one pool per key.
- **Every account is derived.** A Solana transaction lists every account it touches before it
  runs, so the key must be known when the program compiles, and compiling adds the accounts a swap
  at each pool takes to `main`. The command reads each pool from the cluster as it builds the cook,
  with the Pot's own, so it is given no account. A key with no pool there is an empty slot: its
  accounts are the System program, `11111111111111111111111111111111`, and its swap returns 0.
- **One call per pool.** Each is `<Venue>.swap(pool, tokenIn, tokenOut, amountIn, priceLimit,
minOut)` (`sauce-swaps` gives each argument), offered everything still unspent. What it buys
  lands in the Pot's own account for the token bought, and it returns what arrived, `0` for a pool
  it skipped.
- **About five pools fit one cook**, the program staged and its accounts in a lookup table. Keys
  that find more are refused before anything is signed, naming each key's pool.

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
6. **Sends on only what was bought**, to `recipient`; what is left of the budget stays in the Pot,
   and so does the rest of what the Pot holds.

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
its pool takes and how to list a pair's pools are in [references/venues.md](references/venues.md).

## The program

[examples/solana-distributed-swap.sauce.ts](examples/solana-distributed-swap.sauce.ts) is one
complete implementation of those rules, buying SOL with USDC at Orca's and Raydium's pools of the
pair; its header gives every input with its units and how to run it. Each venue's byte layout,
instruction format and account order is `@sauce/router`'s, which every compile the package makes
resolves with no option. Its code:

```sauce chain=solana
// Each pool is found by its key: `Orca.Whirlpool.pool(USDC, WSOL, 4)` is the pool Orca's program
// keeps for the pair at tick spacing 4, and a loop over keys finds one pool for each. Each swap is
// `@sauce/router`'s at that venue: it returns 0 having moved nothing for a key with no pool, a spent
// budget, an empty or past-limit pool and one whose fee is not one rate, else offers the pool the
// amount it is given up to its own fee-adjusted limit, and returns what arrived in the Pot.
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
  for (const spacing of [1, 4, 64]) {
    bought += Orca.Whirlpool.swap(
      Orca.Whirlpool.pool(USDC, WSOL, spacing),
      USDC,
      WSOL,
      self.USDC - kept,
      priceLimit,
      0,
    );
  }
  for (const fee of [400]) {
    bought += Raydium.CLMM.swap(
      Raydium.CLMM.pool(USDC, WSOL, fee),
      USDC,
      WSOL,
      self.USDC - kept,
      priceLimit,
      0,
    );
  }

  const unspent = self.USDC - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  // The SOL bought goes to the recipient; what is left of the budget stays in the Pot.
  if (bought > 0) {
    WSOL.transfer(recipient, bought);
  }
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
  account for the token bought. The command fills every one, so it is given none.
- **The paying side.** Through the Kitchen the program acts as the Pot: the budget is in the Pot's
  USDC account, what is bought lands in its WSOL account, and `self.USDC` is the Pot's USDC
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
  the Pot to the recipient's WSOL account; given the Pot's own address (`sauce pot --chain solana
--owner <owner>` prints it), it stays in the Pot. The transfer is checked: the account it pays
  must be the recipient's own. `main` returns `{ spent, bought, unspent }`, which `sauce simulate`
  prints by name.

**Other pools.** Each venue is one loop over its keys, or one call with its key written in: add a
venue as one more loop (`for (const fee of [100]) { bought += Pancakeswap.CLMM.swap(
Pancakeswap.CLMM.pool(USDC, WSOL, fee), USDC, WSOL, self.USDC - kept, priceLimit, 0); }`), and a
key by adding it to its list. Another pair is the symbols in every call and in `self.USDC`. Keep
to what fits in one cook (below).

## Inputs and units

`main`'s arguments, in order: `budget`, `priceLimit`, `minTokens`, `maxAvgPrice` and `recipient`,
every amount in a token's base units. `recipient` is a wallet, paid into its own WSOL account, or
the Pot's own address to keep what was bought in the Pot.

On Solana USDC has 6 decimals and SOL 9, so `1000000000` is 1,000 USDC and also 1 SOL. A pool
holds SOL wrapped, the mint the registry names `WSOL` (`sauce pools` takes `SOL` for it too).
Selling one token for another is buying the other with it: a program selling SOL for USDC pays
WSOL and buys USDC.

**`priceLimit`** is payToken base units per buyToken base unit, times 1e18:
`priceLimit = price × 10^(18 + payDecimals − buyDecimals)`, with `price` in whole payToken per
whole buyToken. Paying USDC (6) for SOL (9), that is the price × 10^15.

| Trade                                   | Price                    | `priceLimit`            |
| --------------------------------------- | ------------------------ | ----------------------- |
| Buy SOL with USDC                       | at most 120 USDC         | **120000000000000000**  |
| Buy SOL with USDC, at a floor           | at least 0.0084 SOL each | **119047619047619047**  |
| Buy USDC with SOL (sell SOL at a floor) | at least 118 USDC        | **8474576271186440677** |

**A floor is a ceiling turned over.** `priceLimit` is always what one unit bought may cost, in the
token paid. A limit given as the least bought per unit paid ("never below 0.0084 SOL per USDC") is
its inverse, `priceLimit = 10^(18 + payDecimals − buyDecimals) ÷ floor`, rounded down so no unit
fills below the floor: paying USDC for SOL at 0.0084, `10^15 ÷ 0.0084`, 119.047619 USDC per SOL.
The third row is the same: 1 SOL for at least 118 USDC is at most `1 ÷ 118` SOL per USDC, so
`10^9 × 1e18 ÷ (118 × 10^6)`, rounded down.

**`minTokens`** is `budget × 1e18 ÷ priceLimit`, rounded up, to spend all of the budget or nothing:
buying SOL with 1,000 USDC at most 120, `8333333334` (8.333333334 SOL); less (or `0`) to take what
fills within `priceLimit` and keep the rest of the budget in the Pot.

**`maxAvgPrice`**, in `priceLimit`'s units (`0` off), is halfway from a simulation's average
(`spent × 1e18 ÷ bought`) to `priceLimit`, rounded up: a simulation averaging 119.5 USDC per SOL
with `priceLimit` 120 gives 119.75, **119750000000000000**.

**The reference price** is the best a buyer pays, fee included, among pools deep enough for the
order: a pool's price divided by `1 − fee` paying the higher-key token, the same upside down paying
the other. `priceLimit` is that plus the slippage you accept, kept tight. Solana's pool prices
differ between venues more than an EVM chain's: a thin pool can sit a percent or two from the deep
ones, and an order book's offers further still. A `priceLimit` at or below the best price trades
nothing and keeps the whole budget in the Pot, without reverting.

## What fits in one cook

A cook is one Solana transaction: at most 1,232 bytes and 64 accounts, and 1,400,000 compute units.

- **The program is staged.** It is about 3.7 KB, past one transaction, so it runs from a code
  buffer it is written into first; `sauce run` does that (`sauce-solana`).
- **The accounts go through a lookup table.** The program names 45 accounts, every one derived:
  nine for each key, the Pot's, the mints', the programs' and the recipient's. A key with no pool
  names the System program nine times, one account; each pool found brings eight of its own. The
  cook names each account once; listed in the transaction they would be past its size, and
  through an address lookup table they are one byte each.
- **About five pools fit.** Keys that find five pools, the Pot's and the recipient's accounts and
  the cook's own come to about 60 accounts of 64. Keys that find more are refused before anything
  is signed: the command names the pool each key found (`Orca.Whirlpool.pool(USDC, WSOL, 4) is
<pool>`, `… finds none`), so drop the keys you want least. Measured on the venues' own programs:
  about 110,000 compute units for the program around its pools, each pool that trades about
  190,000, each pool skipped after its reads about 90,000 to 100,000, each key with no pool about
  13,000; two trading pools and two keys with none take about 520,000 of the 1,400,000. Pools that
  share a program or a config cost fewer accounts.

## Running it

Three steps, each a `sauce` command, every input on `--args`. Every amount is base units but the
command's token amounts: `--assume-balance USDC:1000` is 1,000 USDC in whole tokens
(`USDC:1000000000n`, with a trailing `n`, the same in base units).

1. **Choose the keys.** `sauce pools --chain solana USDC WSOL --json` reads every pool of the pair
   at the venues above, deepest first, each with its `venue`, `pool`, `key` (how a program finds
   it: `Orca.Whirlpool.pool(USDC, WSOL, 4)`), `fee`, `liquidity`, and its price both ways with the
   fee (`sides[].taker`, and as `priceLimit`). A pool the program would skip is under `skipped`,
   with `why`; `checked` names each venue read. A venue that could not be read (an endpoint
   refusing the scan) leaves the listing partial, said in a note, and the command exits 1: run it
   again, or give an endpoint that answers `getProgramAccounts`. Put the keys of the deepest pools
   whose price is within the limit in the program's lists, the deepest venue first.

   ```sh
   sauce pools --chain solana USDC WSOL --json
   ```

   A pool deep enough may take the whole order, and the pools after it then trade nothing: that is
   the program spending within the limit, not a pool wasted.

2. **Simulate**, with no key and nothing sent. The cook is past one transaction, so
   `sauce simulate` runs it in a local copy of every account it names, read from the cluster, with
   the released engine and Kitchen (`sauce-solana`): `--owner` is any wallet's address, or any
   address with no account, never a program's account such as a pool or a mint;
   `--assume-balance` gives the Pot's USDC account the budget in that copy. `<recipient>` is a
   wallet, or the Pot's address. The program file is the example's, in the project (or run where
   the skill is installed):

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --assume-balance USDC:1000 --args 1000000000 120000000000000000 0 0 <recipient>
   ```

   Simulate once with `minTokens` and `maxAvgPrice` 0 to read what fills and its average, once with
   `minTokens` above what filled, once with `maxAvgPrice` below the average; then set them by the
   rules above. A simulation that reverts exits 1, its first line `The cook reverts: <reason>`, so
   hold each guard to its revert with `--expect-revert`, which exits 0 only when the cook reverts
   with that reason:

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --assume-balance USDC:1000 --args 1000000000 120000000000000000 8333333334 0 <recipient> \
     --expect-revert "bought below minTokens"
   ```

   and `--expect-revert "average too high"` for the average. Over MCP, `sauce_simulate`'s
   `scenarios`, each with its own `expectRevert`, simulate all three in local copies of one read of
   the cluster, at one slot. A token account the cluster does not have yet, such as a new Pot's
   WSOL account or the recipient's, the copy makes empty and a note names; `sauce run` creates it
   before the cook.

3. **Send** with `sauce run`, signed by the owner's `--keypair` (or `--wallet`), the budget already
   in the Pot's USDC account (a transfer into it from any wallet). `sauce run` creates the Pot and
   the token accounts the cook names that do not exist yet, the Pot's WSOL account and the
   recipient's (asking first, or with `--yes`; the owner pays their rent), stages the program in a
   code buffer, creates an address lookup table holding the cook's accounts (it prints its
   address; a later cook naming the same accounts reuses it with `--lookup-table <address>`),
   simulates the staged cook, sends it, and closes the buffer:

   ```sh
   sauce run solana-distributed-swap.sauce.ts --chain solana --keypair <keypair> \
     --args 1000000000 120000000000000000 8333333334 119750000000000000 <recipient>
   ```

   For another signer, `sauce tx` prints the cook as a plan of steps (setup, cook, the buffer's
   close) for `sauce send … --cursor <cursor>` (`sauce-solana`).

**Reading a simulation.** **A simulation counts only when it succeeds and `bought` is above 0**:
anything else (a failure, a revert, nothing bought) is a failed simulation to fix and run again,
never a result. Buying SOL with 2,000 USDC, Orca's spacing-4 pool deep enough for all of it, the
addresses as placeholders:

```text
The cook succeeds from <owner>: 340680 compute units, returns <the same three words, in hex>
main returns { spent: Uint256; bought: Uint256; unspent: Uint256 }: { spent: 2000000000, bought: 16983900131, unspent: 0 }
Simulated in a local copy (LiteSVM) of the 25 accounts the cook names, read from solana at slot <slot>, with the released engine and Kitchen: the cook does not fit one transaction, and no cluster can stage a program without sending. Nothing was signed or sent:
  the 3837-byte program staged into a code buffer in 7 transactions, as `sauce run` stages it
  the cook from that buffer, from the owner <owner>, which pays the Kitchen's execution fee of <fee> lamports
Token balance changes:
  <account> (potUSDC, the Pot's USDC account), owned by <Pot> (the Pot): -2000 USDC
  <vault> (orcaWhirlpool4VaultA, pool <pool>'s vaultA, paying USDC), owned by <pool> (orcaWhirlpool4Account, …): -16.983900131 WSOL
  <vault> (orcaWhirlpool4VaultB, pool <pool>'s vaultB, paying USDC), owned by <pool> (orcaWhirlpool4Account, …): +2000 USDC
  <account> (recipientWSOL, main's argument recipient's WSOL account), owned by <recipient>: +16.983900131 WSOL
```

- **`main returns`** names the three values: 2,000 USDC spent, 16.983900131 SOL bought, nothing
  unspent; the average, `spent × 1e18 ÷ bought`, is **117758582220433806**, 117.76 USDC per SOL.
- **Each pool that traded** shows its two vaults, named for its venue and key. A key you gave and
  do not see sat out: no pool there, empty, skipped, past its limit, or the budget ran out first.
- **A partial fill** leaves what is left of the budget in the Pot's USDC account.

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
- **A program's account as `--owner`** (a pool, a mint). The owner signs and pays: a wallet, or an
  address with no account.

## Files

- [examples/solana-distributed-swap.sauce.ts](examples/solana-distributed-swap.sauce.ts): the
  program.
- [examples/solana-distributed-swap.mts](examples/solana-distributed-swap.mts) compiles the program
  for Solana and pins this page to it: the code above, the venues, their program ids, the names a
  program calls them by, the keys they find pools by and their functions in `@sauce/router`, the
  pool layouts it reads, `priceLimit`, `minTokens` and `maxAvgPrice`, and the accounts it derives.
- [references/venues.md](references/venues.md): each venue's pool layout, how its program derives
  a pool from its key, the nine accounts a swap at its pool takes, and how to list a pair's pools.
