<!-- Generated from skills/sauce-solana-distributed-swap/SKILL.md for the manual. Edit that file, not this one. -->

# A distributed swap on Solana

**How-to guide** · [Documentation](../README.md)

> The same order on Solana: buy a lot of a token, never paying more than a set price for any of it,
> spread over the pools of several Solana exchanges. Each pool sells what it can below your price,
> and what you have not spent moves on to the next, in one transaction.

The limit order of [the distributed swap](distributed-swap.md), on Solana: one price, the most the caller pays for any
unit, fees included, and every pool trading until its own price reaches it. The method (the price
does the splitting, no sorting, the two checks on the total) is that skill's. This skill owns what
Solana changes: the pools reach the program as `main`'s arguments, found before the cook, and every
account they take is read from them as the cook is built; a venue is read from its pool's owner,
the program is used whole, and what fits in one transaction.

## Core model

- **Pools are `main`'s arguments, found before the cook.** A Solana transaction lists every
  account it touches before it runs, so a program cannot ask a factory for a pool: `sauce pools`
  finds them, and each is one `Address` argument of `main`. Compiling adds the accounts a swap at
  the pool takes to `main`, each derived: the command reads them from the pool on the cluster as it
  builds the cook, with the Pot's own, so it is given no account. A slot with no pool is the System
  program, `11111111111111111111111111111111`.
- **A pool's venue is the program that owns it.** `Solana.swap` reads the pool's owner as the
  program runs, runs that venue's code, and refuses a pool no venue it knows owns, a slot whose
  program is not the pool's owner, and a pool that is not the pair. It trusts nothing it is given.
- **One call per slot.** `main` only hands pools over: each is one
  `Solana.swap(pool, tokenIn, tokenOut, amountIn, maxPrice, minOut)` call ([the `@sauce/router` reference](../api/router.md) gives each
  argument), offered everything still unspent. What it buys lands in the Pot's own account for the
  token bought, and it returns what arrived, `0` for a pool it skipped.
- **The program is used whole.** Write its header for the task and pass every input on `--args`;
  change the code only to add or drop a slot.
- **About five pools fit one cook**, the program staged and its accounts in a lookup table.

## The rules

A correct distributed swap on Solana, whatever its tokens or venues:

1. **Finds its pools before the cook**, and trusts none of them (above).
2. **Skips an empty slot, an empty pool, a pool already past its own limit, one whose fee is not
   one rate, and a slot left only dust.** A venue handed a limit on the wrong side of its price
   fails the whole cook (Raydium's `SqrtPriceLimitOverflow`, Orca's
   `InvalidSqrtPriceLimitDirection`, Crema's `WrongSqrtPriceLimit`), and so do a pool with swaps
   switched off, a paused pool and a market not open: `swap` reads each before calling, so the
   skips are reads, never failures. A dynamic fee, an adaptive fee, or a Byreal pool's decay,
   imbalance or own fee rate is more than the rate the limit is adjusted for, so that pool is
   skipped rather than pay past `maxPrice`; so is a Meteora DLMM pool that takes its fee from the
   token bought, or is not yet active. A remainder too small to buy a unit at a pool's price after
   its fee buys nothing there, so that slot is skipped too.
3. **Gives each pool its own limit, adjusted for its fee.** A concentrated-liquidity pool takes its
   fee from the input, so its last unit costs its price divided by `1 − fee`: each pool's limit is
   the caller's sqrt price moved toward the trade by `√(1 − fee)`, **`limit ÷ √(1 − fee)` paying
   the lower-key token, `limit × √(1 − fee)` paying the other**. An order book charges its fee on
   top, so its limit price is `maxPrice ÷ (1 + fee)`. A Meteora DLMM pool takes no limit: its bins
   are walked in the cook, each at its own fee (a base and a volatility term), and its swap is
   offered exactly what drains those within `maxPrice`, at most eight. The fee is read from the
   pool or its config in the cook.
4. **Offers each pool everything still unspent** and lets the limit stop it. Every venue here takes
   only what it swapped before its price reached the limit (a DLMM pool, only what its bins within
   it drain) and leaves the rest in the Pot: nothing is stranded.
5. **Checks the total**: at least `minTokens` bought, an average no dearer than `maxAvgPrice`.
6. **Refunds only what is left of the budget**, to `refund`, never the Pot's whole balance; what
   was bought goes on to `recipient`.

The order of the slots decides only which pool gets the budget when it runs out first: put the
deepest, cheapest pool first.

## The venues

Every Solana venue the package knows whose swap takes a price limit that stops the swap and leaves
the rest of the input, checked by running each venue's own program, with how a program names its
swap and the function of `@sauce/router` that swap is:

| Venue            | Program                                        | Swap                                    | In a program             | Function          |
| ---------------- | ---------------------------------------------- | --------------------------------------- | ------------------------ | ----------------- |
| Raydium CLMM     | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | `swap_v2`, a sqrt price limit           | `Raydium.CLMM.swap`      | `raydiumClmm`     |
| PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` | the same, on Raydium's code             | `Pancakeswap.CLMM.swap`  | `pancakeswapClmm` |
| Byreal           | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2`  | the same, on Raydium's code             | `Byreal.CLMM.swap`       | `byreal`          |
| Stabble CLMM     | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` | the same, on Raydium's code             | `Stabble.CLMM.swap`      | `stabbleClmm`     |
| Orca Whirlpools  | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`  | `swap_v2`, a sqrt price limit           | `Orca.Whirlpool.swap`    | `orcaWhirlpool`   |
| Cropper          | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` | `swap` on Orca's code (it has no v2)    | `Cropper.Whirlpool.swap` | `cropper`         |
| DefiTuna         | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9`  | `swap`, a sqrt price limit              | `Defituna.Fusion.swap`   | `defituna`        |
| Crema            | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` | `swap`, a sqrt price limit              | `Crema.CLMM.swap`        | `crema`           |
| Phoenix          | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`  | an immediate-or-cancel order at a price | `Phoenix.Market.swap`    | `phoenix`         |
| Meteora DLMM     | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`  | `swap` of what its bins within it drain | `Meteora.DLMM.swap`      | `meteoraDlmm`     |

Each takes `Solana.swap`'s arguments and refuses a pool of any other venue: a program that knows its
venue calls that one and carries only its code. `Solana.swap` takes a pool of any of them, reading
its venue from the pool's owner as it runs (`@sauce/router`'s `swap`), and carries every venue's
code: the distributed swap, which takes its pools as arguments, cannot know their venues.

Meteora DLMM's swap takes no limit, and its price-impact swap fails past its bound
(`ExceededAmountSlippageTolerance`) instead of stopping there, so its function walks the pool's
bins in the cook, as the venue's swap walks them, fee and all, and offers the swap exactly what
drains those within `maxPrice`: the swap stops with the last of them drained. It walks at most
eight bins, from the active one, on the two bin arrays its slot gives (one for a pool with a
Token-2022 mint).

**Left out**, each for what its program does:

- **Invariant** takes a sqrt price limit, but reaching it with input left fails the swap
  (`PriceLimitReached`) instead of stopping it.
- **Bonkswap** takes a price limit and fails the swap past it (`PriceLimitExceeded`).
- **Saros DLMM, Meteora DAMM, Raydium CPMM and AMM v4, PumpSwap, the stable and weighted pools, the
  proprietary market makers (HumidiFi, SolFi, Tessera V, Obric, ZeroFi, GoonFi) and Manifest** take
  only a minimum output: they fill in full at whatever price, so they cannot stop at one.

Each venue's pool layout, the nine accounts a swap at its pool takes and how to find its pools are
in [the venues, their pools and their slots](#the-venues-their-pools-and-their-slots).

## The program

`solana-distributed-swap.sauce.ts` is one
complete implementation of those rules, over four slots, any venue in each; its header gives every
input with its units and how to run it. **Use its code whole.** Each venue's byte layout,
instruction format and account order is `@sauce/router`'s, which every compile the package makes
resolves with no option. Its code:

```ts
// A limit buy over Solana's price-limited pools: up to `budget` of one token for another, never
// more than `maxPrice` for any unit, fees included. Four pools, each at any venue that
// `sauce pools --chain solana` lists, given by its address: compiling adds each pool's accounts to
// main, read from the pool on the cluster when the cook is built, with the Pot's own, so the
// command is given no account.
//
//   sauce run solana-distributed-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <pay> <buy> <pool0> <pool1> <pool2> <pool3> \
//     <budget> <maxPrice> <minTokens> <maxAvgPrice> <recipient> <refund>
//
//   pay: Address          the token paid, its mint or symbol (USDC); the budget must be in the Pot
//   buy: Address          the token bought, the same way (WSOL)
//   pool0: Address        the first pool, as sauce pools --pay gives the pools (poolArgs, in slot
//                         order); an empty slot is the System program,
//                         11111111111111111111111111111111
//   pool1: Address        the second pool, the same way
//   pool2: Address        the third pool, the same way
//   pool3: Address        the fourth pool, the same way
//   budget: Uint256       the most payToken to spend, in its base units: 1000000000 is 1,000 USDC
//   maxPrice: Uint256     the most one buyToken may cost, fees included: the price in whole tokens
//                         times 10^(18 + payDecimals − buyDecimals)
//   minTokens: Uint256    the least buyToken to receive, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in maxPrice's units; 0 turns it off
//   recipient: Address    receives what is bought; the Pot's own address keeps it in the Pot
//   refund: Address       receives what is left of the budget; the Pot's own address keeps it there
//
//   SOL for all of 1,000 USDC or nothing, at most 120 USDC each, simulated with no key:
//   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
//     --assume-balance USDC:1000 --args USDC WSOL <pool0> <pool1> <pool2> <pool3> \
//     1000000000 120000000000000000 8333333334 0 <recipient> <refund>

// Each `Solana.swap` is `@sauce/router`'s swap at the pool's venue, read from the pool's owner: it
// returns 0 having moved nothing for an empty slot, a spent budget, an empty, paused or past-limit
// pool and one whose fee is not one rate, else offers the pool the amount it is given up to its own
// fee-adjusted limit, and returns what arrived in the Pot.
function main(
  pay: Address,
  buy: Address,
  pool0: Address,
  pool1: Address,
  pool2: Address,
  pool3: Address,
  budget: Uint256,
  maxPrice: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
  refund: Address,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  require(maxPrice > 0, "maxPrice is 0");
  const held = Token(pay).balanceOf(ctx.self());
  require(held >= budget, "budget is not in the Pot");
  const kept = held - budget; // the Pot's other payToken, never spent
  const before = Token(buy).balanceOf(ctx.self());

  // Each slot in turn, offered all of the budget still unspent; swap decides and swaps.
  Solana.swap(pool0, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);
  Solana.swap(pool1, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);
  Solana.swap(pool2, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);
  Solana.swap(pool3, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);

  // Settle: what was bought goes to the recipient, what is left of the budget to refund, each only
  // when it is not the Pot itself.
  const unspent = Token(pay).balanceOf(ctx.self()) - kept;
  const spent = budget - unspent;
  const bought = Token(buy).balanceOf(ctx.self()) - before;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  if (bought > 0 && recipient != Solana.self.address) {
    Token(buy).transfer(recipient, bought);
  }
  if (unspent > 0 && refund != Solana.self.address) {
    Token(pay).transfer(refund, unspent);
  }
  return { spent, bought, unspent };
}
```

- **Inputs.** Every input is a `main` argument, passed with `--args`: the two tokens (`pay` and
  `buy`, each a mint), the four pools, the four amounts (`budget`, `maxPrice`, `minTokens`,
  `maxAvgPrice`), and who gets what was bought and what is left (`recipient`, `refund`). The program
  names no token, pool or account, so one file buys any token with any other, SPL or Token-2022, at
  any four pools.
- **The accounts are derived.** Compiling adds every account the program uses to `main`, each with
  how it is derived (`sauce compile --json` lists them): each pool's nine, read from the pool for
  the token paid (its tick arrays depend on the direction); the Pot, its accounts for the two
  tokens and the two mints; the token programs and the memo program; and the recipient's and the
  refund's accounts for their tokens. The command fills every one, so it is given none.
- **The paying side.** Through the Kitchen the program acts as the Pot: the budget is in the Pot's
  account for the token paid, what is bought lands in its account for the token bought, and
  `ctx.self()` names the Pot as a token holder. `kept` is whatever else of the paying token the Pot
  holds, so only the budget is ever offered or refunded.
- **Each slot** is offered all of the budget still unspent,
  `Token(pay).balanceOf(ctx.self()) - kept`, with a floor of `0`: the totals are checked once, after
  the slots.
- **`swap`** returns `0` at once for an empty slot or a spent budget. A concentrated-liquidity
  pool: it skips one whose fee is more than one rate or whose swaps are off, reads the mints and
  requires the pair, reads the liquidity, price and fee, works out the pool's own limit, skips an
  empty pool, one not better than that limit and an amount too small to buy a unit at its price
  after its fee, and swaps everything offered up to it. Its price is the square root of the
  higher-key token per lower-key token, times 2^64 (the pair in the order of their 32-byte keys), so
  `maxPrice` as that price is `√(maxPrice × 2^128 ÷ 1e18)` paying the higher-key token and, upside
  down, `√(2^128 × 1e18 ÷ maxPrice)` paying the lower-key one, before the fee moves it; the root is
  rounded down, so the pool stops a little sooner, never later. Phoenix: it skips a market not open
  for taking, requires the pair, turns `maxPrice` into a limit in ticks less the taker fee, and
  places an immediate-or-cancel order for every lot offered; offers past the limit stay on the book.
- **Settle.** A `require` reverts the whole cook, every swap included. What was bought goes from
  the Pot to the recipient's account for the token bought, and what is left of the budget to the
  refund's account for the token paid, each only when it is not the Pot itself: given the Pot's own
  address (`Solana.self.address` in the program), it stays in the Pot. Each transfer is the checked
  one, so Token-2022 mints move too, and the account it pays must be the recipient's own. `main`
  returns `{ spent, bought, unspent }`, which `sauce simulate` prints by name.

**A fifth slot, or fewer.** A slot is one `Address` argument and one `Solana.swap` call. To add
one, declare `pool4: Address` after `pool3`, and call
`Solana.swap(pool4, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0)` after the
fourth call.
`solana-distributed-swap-5.sauce.ts` is the
program with that slot, used whole as the four-slot one is (`sauce pools … --slots 5` gives five
pools). To drop one, remove its argument and its call; an unused slot can also stay, given the
System program.

## Inputs and units

`main`'s arguments, in order: `pay`, `buy`, `pool0` to `pool3`, `budget`, `maxPrice`, `minTokens`,
`maxAvgPrice`, `recipient` and `refund`, every amount in a token's base units. `pay` and `buy` are
mints, each also given by a symbol the chain registers (`USDC`, `WSOL`). The pools are as
`sauce pools` gives them, in slot order. `recipient` and `refund` are wallets, each paid into its
own account for the token, or the Pot's own address to keep that in the Pot
(`sauce pot --chain solana --owner <owner>` prints it).

Selling one token for another is buying the other with it: selling USDC for SOL pays USDC and buys
SOL. On Solana USDC has 6 decimals and SOL 9, so `1000000000` is 1,000 USDC and also 1 SOL. A pool
holds SOL wrapped, the mint the registry names `WSOL` (`sauce pools` takes `SOL` for it too).

**`maxPrice`** is payToken base units per buyToken base unit, times 1e18:
`maxPrice = price × 10^(18 + payDecimals − buyDecimals)`, with `price` in whole payToken per whole
buyToken. Paying USDC (6) for SOL (9), that is the price × 10^15.

| Trade                                   | Price                    | `maxPrice`              |
| --------------------------------------- | ------------------------ | ----------------------- |
| Buy SOL with USDC                       | at most 120 USDC         | **120000000000000000**  |
| Buy SOL with USDC, at a floor           | at least 0.0084 SOL each | **119047619047619047**  |
| Buy USDC with SOL (sell SOL at a floor) | at least 118 USDC        | **8474576271186440677** |

**A floor is a ceiling turned over.** `maxPrice` is always what one unit bought may cost, in the
token paid. A limit given as the least bought per unit paid ("never below 0.0084 SOL per USDC") is
its inverse, `maxPrice = 10^(18 + payDecimals − buyDecimals) ÷ floor`, rounded down so no unit
fills below the floor: paying USDC for SOL at 0.0084, `10^15 ÷ 0.0084`, 119.047619 USDC per SOL.
The third row is the same: 1 SOL for at least 118 USDC is at most `1 ÷ 118` SOL per USDC, so
`10^9 × 1e18 ÷ (118 × 10^6)`, rounded down.

**`minTokens`** is `budget × 1e18 ÷ maxPrice`, rounded up, to spend all of the budget or nothing:
buying SOL with 1,000 USDC at most 120, `8333333334` (8.333333334 SOL); less (or `0`) to take what
fills within `maxPrice` and get the rest back.

**`maxAvgPrice`**, in `maxPrice`'s units (`0` off), is halfway from a simulation's average
(`spent × 1e18 ÷ bought`) to `maxPrice`, rounded up: a simulation averaging 119.5 USDC per SOL with
`maxPrice` 120 gives 119.75, **119750000000000000**.

**The reference price** is the best a buyer pays, fee included, among pools deep enough for the
order: a pool's price divided by `1 − fee` paying the higher-key token, the same upside down paying
the other. `maxPrice` is that plus the slippage you accept, kept tight. Solana's pool prices differ
between venues more than an EVM chain's: a thin pool can sit a percent or two from the deep ones,
and an order book's offers further still. A `maxPrice` at or below the best price trades nothing and
refunds the whole budget, without reverting.

## What fits in one cook

A cook is one Solana transaction: at most 1,232 bytes and 64 accounts, and 1,400,000 compute units.

- **The program is staged.** It is about 8.8 KB, well past one transaction, so it runs from a code
  buffer it is written into first; `sauce run` does that ([Solana](solana.md)).
- **The accounts go through a lookup table.** The program names 48 accounts, every one derived:
  four slots of nine, the Pot's, the mints', the programs' and the settle's. The cook names each
  account once, about 44 for two SPL Token mints; listed in the transaction they are over 1,400
  bytes, and through an address lookup table one byte each. With the program staged and its
  accounts in a table, the cook is about 400 bytes.
- **About five pools fit.** Four distinct pools, the Pot's and the settle's accounts and the cook's
  own come to about 52 accounts of 64; a fifth pool brings eight more, about 60. Measured on the
  venues' own programs: about 220,000 compute units with every slot empty, each pool that trades
  about 190,000 more, each pool skipped after its reads about 80,000; four trading pools take about
  960,000 of the 1,400,000, the settle's two transfers about 60,000 of them, and the five-slot
  program with four trading and one skipped about 1,060,000. A Meteora DLMM pool costs about
  26,000 more for each bin it drains: four slots, one a DLMM pool draining its eight, about
  1,220,000. Pools that share a program or a config
  cost fewer accounts.
- **Which pools, then.** The cook carries the four or five best the search found, the deepest and
  cheapest first. More pools than fit is more than one cook.

## Running it

Three steps, each a `sauce` command, every input on `--args`. Every amount is base units but the
command's token amounts: `--assume-balance USDC:1000` is 1,000 USDC in whole tokens
(`USDC:1000000000n`, with a trailing `n`, the same in base units).

1. **Find the pools and put them in slot order.** `sauce pools --chain solana USDC WSOL --json`
   reads every pool of the pair at the venues above, deepest first, each with its `venue`, `pool`,
   `fee`, `liquidity`, its price both ways with the fee (`sides[].taker`, and as `maxPrice`), and
   `slots`: by the token paid, the nine accounts a swap at it takes, which the cook reads itself. A
   pool the program skips is under `skipped`, with `why`; `checked` names each venue read. A venue
   that could not be read (an endpoint refusing the scan) leaves the listing partial, said in a
   note, and the command exits 1: run it again, or give an endpoint that answers
   `getProgramAccounts`. `--pay` chooses the pools, the deepest whose price with the fee is within
   `--max-price`, one a venue with `--per-venue` (to cover every venue with a pool within the
   limit), as many as `--slots` (4, the program's; 5 with a fifth slot), and prints `chosen` and
   `poolArgs`: the pools in slot order, every slot past the last chosen the System program, ready
   for `--args`:

   ```sh
   sauce pools --chain solana USDC WSOL --pay USDC --max-price 119047619047619047 --per-venue --json
   ```

   A pool deep enough may take the whole order, and the slots after it then trade nothing: that is
   the program spending within the limit, not a slot wasted.

2. **Simulate**, with no key and nothing sent. The cook is past one transaction, so
   `sauce simulate` runs it in a local copy of every account it names, read from the cluster, with
   the released engine and Kitchen ([Solana](solana.md)): `--owner` is any wallet's address, or any
   address with no account, never a program's account such as a pool or a mint;
   `--assume-balance` gives the Pot's USDC account the budget in that copy. `<pool0>` … `<pool3>`
   are step 1's `poolArgs`, and `<recipient>` and `<refund>` a wallet each, or the Pot's address.
   The program file is the example's, in the project (or run where the skill is installed):

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --assume-balance USDC:1000 --args USDC WSOL <pool0> <pool1> <pool2> <pool3> \
     1000000000 120000000000000000 0 0 <recipient> <refund>
   ```

   Simulate once with `minTokens` and `maxAvgPrice` 0 to read what fills and its average, once with
   `minTokens` above what filled, once with `maxAvgPrice` below the average; then set them by the
   rules above. A simulation that reverts exits 1, its first line `The cook reverts: <reason>`, so
   hold each guard to its revert with `--expect-revert`, which exits 0 only when the cook reverts
   with that reason:

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --assume-balance USDC:1000 --args USDC WSOL <pool0> <pool1> <pool2> <pool3> \
     1000000000 120000000000000000 8333333334 0 <recipient> <refund> \
     --expect-revert "bought below minTokens"
   ```

   and `--expect-revert "average too high"` for the average. Over MCP, `sauce_simulate`'s
   `scenarios`, each with its own `expectRevert`, simulate all three in local copies of one read of
   the cluster, at one slot. A token account the cluster does not have yet, such as a new Pot's
   WSOL account or the recipient's, the copy makes empty and a note names; `sauce run` creates it
   before the cook.

3. **Send** with `sauce run`, signed by the owner's `--keypair` (or `--wallet`), the budget already
   in the Pot's USDC account (a transfer into it from any wallet). `sauce run` creates the Pot and
   the token accounts the cook names that do not exist yet, the Pot's for the token bought and the
   recipient's and the refund's (asking first, or with `--yes`; the owner pays their rent), stages
   the program in a code buffer, creates an address lookup table holding the cook's accounts (it
   prints its address; a later cook naming the same accounts reuses it with
   `--lookup-table <address>`), simulates the staged cook, sends it, and closes the buffer:

   ```sh
   sauce run solana-distributed-swap.sauce.ts --chain solana --keypair <keypair> \
     --args USDC WSOL <pool0> <pool1> <pool2> <pool3> \
     1000000000 120000000000000000 8333333334 119750000000000000 <recipient> <refund>
   ```

   For another signer, `sauce tx` prints the cook as a plan of steps (setup, cook, the buffer's
   close) for `sauce send … --cursor <cursor>` ([Solana](solana.md)).

**Reading a simulation.** **A simulation counts only when it succeeds and `bought` is above 0**:
anything else (a failure, a revert, nothing bought, every pool the System program) is a failed
simulation to fix and run again, never a result. Buying SOL with 2,000 USDC over four pools, the
first deep enough for all of it, the addresses as placeholders:

```text
The cook succeeds from <owner>: 383737 compute units, returns <the same three words, in hex>
main returns { spent: Uint256; bought: Uint256; unspent: Uint256 }: { spent: 2000000000, bought: 16983900131, unspent: 0 }
Simulated in a local copy (LiteSVM) of the 41 accounts the cook names, read from solana at slot <slot>, with the released engine and Kitchen: the cook does not fit one transaction, and no cluster can stage a program without sending. Nothing was signed or sent:
  the 9230-byte program staged into a code buffer in 13 transactions, as `sauce run` stages it
  the cook from that buffer, from the owner <owner>, which pays the Kitchen's execution fee of <fee> lamports
Token balance changes:
  <account> (potPay, the Pot's USDC account), owned by <Pot> (the Pot): -2000 USDC
  <vault> (pool0VaultA, pool <pool0>'s vaultA, paying USDC), owned by <pool0> (pool0Account, …): -16.983900131 WSOL
  <vault> (pool0VaultB, pool <pool0>'s vaultB, paying USDC), owned by <pool0> (pool0Account, …): +2000 USDC
  <account> (recipientBuy, main's argument recipient's WSOL account), owned by <recipient>: +16.983900131 WSOL
```

- **`main returns`** names the three values: 2,000 USDC spent, 16.983900131 SOL bought, nothing
  unspent; the average, `spent × 1e18 ÷ bought`, is **117758582220433806**, 117.76 USDC per SOL.
- **Each pool that traded** shows its two vaults. A pool you gave and do not see sat out: an empty
  slot, empty, skipped, past its limit, or the budget ran out first.
- **A partial fill** ends with what is left of the budget moving from the Pot's account to the
  refund's.

## Pitfalls

- **Rewriting the program.** Use it whole; only add or drop slots.
- **A token account as `recipient` or `refund`.** Each is the wallet paid: the cook pays that
  wallet's own account for the token. A token account given there is taken as a wallet, and the
  cook pays an account it holds, which no one can spend from.
- **The budget not in the Pot.** It must be in the Pot's account for the token paid when the cook
  runs (`budget is not in the Pot` otherwise); a simulation gives it with `--assume-balance`.
- **A simulation that bought nothing taken as a result.** Only a success with `bought` above 0
  counts.
- **`maxPrice` given as a floor.** Turn a least-bought-per-unit limit over:
  `10^(18 + payDecimals − buyDecimals) ÷ floor`, rounded down.
- **More slots than fit.** Four, or five with the fifth slot; more is more than one cook.
- **A program's account as `--owner`** (a pool, a mint). The owner signs and pays: a wallet, or an
  address with no account.

## The venues, their pools and their slots

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
other way, or with arrays holding no liquidity, which the swap loads and never walks into. A pool
whose price is far from 1 may also need its bitmap extension, the program address of
`["pool_tick_array_bitmap_extension", pool]`, in one of the three.

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

### Meteora DLMM

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

### Finding a pair's pools

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
