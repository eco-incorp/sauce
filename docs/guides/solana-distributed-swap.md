<!-- Generated from skills/sauce-solana-distributed-swap/SKILL.md for the manual. Edit that file, not this one. -->

# A distributed swap on Solana

The limit order of [the distributed swap](distributed-swap.md), on Solana: one price, the most the caller pays for any
unit, fees included, and every pool trading until its own price reaches it. The method (the price
does the splitting, no sorting, the two checks on the total) is that skill's. This skill owns what
Solana changes: the pools reach the program as slots of accounts found before the cook, a venue is
read from its pool's owner, the program is used whole, and what fits in one transaction.

## Core model

- **Pools are accounts, found before the cook.** A Solana transaction lists every account it
  touches before it runs, so a program cannot ask a factory for a pool: `sauce pools` finds them,
  and each is passed in a **slot of nine accounts**. A slot with no pool is the System program in
  all nine.
- **A pool's venue is the program that owns it.** `@sauce/router`'s `trySwap` reads the pool's
  owner, runs that venue's code, and refuses a pool no venue it knows owns, a slot whose program is
  not the pool's owner, and a pool that is not the pair. It trusts nothing it is given.
- **One call per slot.** `main` only hands slots over: each is one `trySwap` call,
  `(slot, trader, amountIn, maxPrice, minOut, recipient)` ([the `@sauce/router` reference](../api/router.md) gives each argument),
  offered everything still unspent, returning what arrived, `0` for a pool it skipped.
- **The program is used whole.** Write its header for the task, fill the slots and pass the inputs;
  change the code only to add or drop a slot.
- **About five pools fit one cook**, the program staged and its accounts in a lookup table.

## The rules

A correct distributed swap on Solana, whatever its tokens or venues:

1. **Takes its pools as accounts, found before the cook**, and trusts none of them (above).
2. **Skips a missing slot, an empty pool, a pool already past its own limit, one whose fee is not
   one rate, and a slot left only dust.** A venue handed a limit on the wrong side of its price fails
   the whole cook (Raydium's `SqrtPriceLimitOverflow`, Orca's `InvalidSqrtPriceLimitDirection`,
   Crema's `WrongSqrtPriceLimit`), and so do a pool with swaps switched off, a paused pool and a
   market not open: `trySwap` reads each before calling, so the skips are reads, never failures. A
   dynamic fee, an adaptive fee, or a Byreal pool's decay, imbalance or own fee rate is more than the
   rate the limit is adjusted for, so that pool is skipped rather than pay past `maxPrice`. A
   remainder too small to buy a unit at a pool's price after its fee buys nothing there, so that
   slot is skipped too.
3. **Gives each pool its own limit, adjusted for its fee.** A concentrated-liquidity pool takes its
   fee from the input, so its last unit costs its price divided by `1 − fee`: each pool's limit is
   the caller's sqrt price moved toward the trade by `√(1 − fee)`, **`limit ÷ √(1 − fee)` paying
   the lower-key token, `limit × √(1 − fee)` paying the other**. An order book charges its fee on
   top, so its limit price is `maxPrice ÷ (1 + fee)`. The fee is read from the pool or its config
   in the cook.
4. **Offers each pool everything still unspent** and lets the limit stop it. Every venue here takes
   only what it swapped before its price reached the limit and leaves the rest in the paying
   account: nothing is stranded.
5. **Checks the total**: at least `minTokens` bought, an average no dearer than `maxAvgPrice`.
6. **Refunds only what is left of the budget**, to `refund`, never the account's whole balance;
   what was bought goes on to `recipient`.

The order of the slots decides only which pool gets the budget when it runs out first: put the
deepest, cheapest pool first.

## The venues

Every Solana venue the package knows whose swap takes a price limit that stops the swap and leaves
the rest of the input, checked by running each venue's own program, with its function in
`@sauce/router`:

| Venue            | Program                                        | Swap                                    | Function             |
| ---------------- | ---------------------------------------------- | --------------------------------------- | -------------------- |
| Raydium CLMM     | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | `swap_v2`, a sqrt price limit           | `tryRaydiumClmm`     |
| PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` | the same, on Raydium's code             | `tryPancakeswapClmm` |
| Byreal           | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2`  | the same, on Raydium's code             | `tryByreal`          |
| Stabble CLMM     | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` | the same, on Raydium's code             | `tryStabbleClmm`     |
| Orca Whirlpools  | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`  | `swap_v2`, a sqrt price limit           | `tryOrcaWhirlpool`   |
| Cropper          | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` | `swap` on Orca's code (it has no v2)    | `tryCropper`         |
| DefiTuna         | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9`  | `swap`, a sqrt price limit              | `tryDefituna`        |
| Crema            | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` | `swap`, a sqrt price limit              | `tryCrema`           |
| Phoenix          | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`  | an immediate-or-cancel order at a price | `tryPhoenix`         |

Each takes `trySwap`'s arguments and refuses a pool of any other venue; a program that knows its
venue calls that one and carries only its code. The forms without `try` (`raydiumClmm`, …,
`phoenix`, and `swap` for `trySwap`) revert where the `try` form returns `0`.

**Left out**, each for what its program does:

- **Invariant** takes a sqrt price limit, but reaching it with input left fails the swap
  (`PriceLimitReached`) instead of stopping it.
- **Meteora DLMM**: its swap has no limit, and its price-impact swap fails past its bound
  (`ExceededAmountSlippageTolerance`) instead of stopping there.
- **Bonkswap** takes a price limit and fails the swap past it (`PriceLimitExceeded`).
- **Saros DLMM, Meteora DAMM, Raydium CPMM and AMM v4, PumpSwap, the stable and weighted pools, the
  proprietary market makers (HumidiFi, SolFi, Tessera V, Obric, ZeroFi, GoonFi) and Manifest** take
  only a minimum output: they fill in full at whatever price, so they cannot stop at one.

Each venue's pool layout, the nine accounts its slot takes and how to find its pools are in
[the venues, their pools and their slots](#the-venues-their-pools-and-their-slots).

## The program

`solana-distributed-swap.sauce.ts` is one
complete implementation of those rules, over four slots, any venue in each; its header gives every
input with its units and how to run it. **Use its code whole.** Each venue's byte layout,
instruction format and account order is `@sauce/router`'s, which every compile the package makes
resolves with no option. Its code:

```ts
// A limit buy over Solana's price-limited pools: up to `budget` of one token for another, never
// more than `maxPrice` for any unit, fees included. Four pool slots, each a pool at any venue that
// `sauce pools --chain solana` lists, which gives each slot's nine accounts too.
//
//   sauce run solana-distributed-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --accounts <accounts.json> --args <budget> <maxPrice> <minTokens> <maxAvgPrice>
//
// The accounts, by name, in one JSON object (or each as --account NAME=<value>):
//   authority     pot: the Pot, which signs for its accounts (owner, cooked with --via engine)
//   source        pot:<payToken>: the authority's account the budget is in
//   output        pot:<buyToken>: the authority's account what is bought arrives in
//   recipient     the account what is bought goes on to (output itself, to keep it there)
//   refund        the account what is left of the budget goes to (source itself, to keep it)
//   payMint       mint:<payToken>; buyMint, mint:<buyToken>
//   tokenProgram  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, and token2022,
//                 TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb, and memo,
//                 MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
//   program<k> pool<k> config<k> vaultA<k> vaultB<k> extra<k> ticks<k>0 ticks<k>1 ticks<k>2
//                 slot k, 0 to 3: a pool's slot paying payToken, as sauce pools gives it; a slot
//                 with no pool is the System program, 11111111111111111111111111111111, in all nine
//
//   budget: Uint256       the most payToken to spend, in its base units: 1000000000 is 1,000 USDC
//   maxPrice: Uint256     the most one buyToken may cost, fees included: the price in whole tokens
//                         times 10^(18 + payDecimals − buyDecimals)
//   minTokens: Uint256    the least buyToken to receive, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in maxPrice's units; 0 turns it off
//
//   SOL for all of 1,000 USDC or nothing, at most 120 USDC each, simulated with no key:
//   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
//     --accounts <accounts.json> --assume-balance USDC:1000 \
//     --args 1000000000 120000000000000000 8333333334 0

// The swaps are `@sauce/router`'s: `trySwap` reads a pool's venue from its owner, skips a missing,
// empty, paused or past-limit pool and one whose fee is not one rate, else offers it the amount it
// is given up to the pool's own fee-adjusted limit, and returns what arrived.
import { trySwap } from "@sauce/router";

function main(
  authority: Account<Signer>,
  source: Account<Writable>,
  output: Account<Writable>,
  recipient: Account<Writable>,
  refund: Account<Writable>,
  payMint: Account,
  buyMint: Account,
  tokenProgram: Account,
  token2022: Account,
  memo: Account,
  program0: Account,
  pool0: Account<Writable>,
  config0: Account,
  vaultA0: Account<Writable>,
  vaultB0: Account<Writable>,
  extra0: Account<Writable>,
  ticks00: Account<Writable>,
  ticks01: Account<Writable>,
  ticks02: Account<Writable>,
  program1: Account,
  pool1: Account<Writable>,
  config1: Account,
  vaultA1: Account<Writable>,
  vaultB1: Account<Writable>,
  extra1: Account<Writable>,
  ticks10: Account<Writable>,
  ticks11: Account<Writable>,
  ticks12: Account<Writable>,
  program2: Account,
  pool2: Account<Writable>,
  config2: Account,
  vaultA2: Account<Writable>,
  vaultB2: Account<Writable>,
  extra2: Account<Writable>,
  ticks20: Account<Writable>,
  ticks21: Account<Writable>,
  ticks22: Account<Writable>,
  program3: Account,
  pool3: Account<Writable>,
  config3: Account,
  vaultA3: Account<Writable>,
  vaultB3: Account<Writable>,
  extra3: Account<Writable>,
  ticks30: Account<Writable>,
  ticks31: Account<Writable>,
  ticks32: Account<Writable>,
  budget: Uint256,
  maxPrice: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  const pay = payMint.address;
  const buy = buyMint.address;
  require(maxPrice > 0, "maxPrice is 0");
  require(ownerOf(pay, source) == authority.address, "source is not the authority's");
  require(ownerOf(buy, output) == authority.address, "output is not the authority's");
  require(balanceOf(pay, source) >= budget, "budget is not in source");
  const kept = balanceOf(pay, source) - budget; // the account's other payToken, never spent
  const before = balanceOf(buy, output);

  // Each slot in turn, offered all of the budget still unspent; trySwap decides and swaps.
  const trader = [authority, source, payMint, buyMint, tokenProgram, token2022, memo];
  trySwap(
    [program0, pool0, config0, vaultA0, vaultB0, extra0, ticks00, ticks01, ticks02],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );
  trySwap(
    [program1, pool1, config1, vaultA1, vaultB1, extra1, ticks10, ticks11, ticks12],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );
  trySwap(
    [program2, pool2, config2, vaultA2, vaultB2, extra2, ticks20, ticks21, ticks22],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );
  trySwap(
    [program3, pool3, config3, vaultA3, vaultB3, extra3, ticks30, ticks31, ticks32],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );

  // Settle: what was bought goes to the recipient, what is left of the budget back.
  const unspent = balanceOf(pay, source) - kept;
  const spent = budget - unspent;
  const bought = balanceOf(buy, output) - before;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  if (bought > 0 && recipient.address != output.address) {
    const program = buyMint.owner == token2022.address ? token2022 : tokenProgram;
    transferChecked(buy, program, output, buyMint, recipient, authority, bought, decimals(buyMint));
  }
  if (unspent > 0 && refund.address != source.address) {
    const program = payMint.owner == token2022.address ? token2022 : tokenProgram;
    transferChecked(pay, program, source, payMint, refund, authority, unspent, decimals(payMint));
  }
  return { spent, bought, unspent };
}
```

- **Inputs.** The amounts are `main`'s last four parameters, passed with `--args`: `budget`,
  `maxPrice`, `minTokens` and `maxAvgPrice`. Everything else is an account: the two mints, the
  accounts the tokens move through, the programs a swap needs, and four slots. The program names no
  token, so one file buys any token with any other, SPL or Token-2022.
- **The paying side.** `authority` signs for `source` and `output`, the paying and receiving token
  accounts. Through the Kitchen it is the Pot (`pot`); cooked directly on the engine
  (`--via engine`) it is the signer's own wallet. Both accounts must be the authority's own (Crema
  and Phoenix pay only into the trader's own account). `kept` is whatever else of the paying token
  `source` holds, so only the budget is ever offered or refunded.
- **Each slot** is offered all of the budget still unspent, `balanceOf(pay, source) - kept`, with a
  floor of `0`: the totals are checked once, after the slots.
- **`trySwap`** returns `0` at once for a missing slot or a spent budget. A concentrated-liquidity
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
  `output` to `recipient`, and what is left of the budget from `source` to `refund` (each when they
  differ), both with `transferChecked`, so Token-2022 mints move too. `main` returns
  `{ spent, bought, unspent }`, which `sauce simulate` prints by name.

**A fifth slot, or fewer.** A slot is nine `main` parameters and one `trySwap` call. To add one,
declare after `ticks32`, as slot 3's are:

```text
program4: Account, pool4: Account<Writable>, config4: Account, vaultA4: Account<Writable>,
vaultB4: Account<Writable>, extra4: Account<Writable>, ticks40: Account<Writable>,
ticks41: Account<Writable>, ticks42: Account<Writable>,
```

and call `trySwap([program4, pool4, config4, vaultA4, vaultB4, extra4, ticks40, ticks41, ticks42],
trader, balanceOf(pay, source) - kept, maxPrice, 0, output)` after the fourth call.
`solana-distributed-swap-5.sauce.ts` is the
program with that slot, used whole as the four-slot one is (`sauce pools … --slots 5` fills it). To
drop one, remove its parameters and its call; an unused slot can also stay, all nine the System
program.

## Inputs and units

`main(… accounts …, budget, maxPrice, minTokens, maxAvgPrice)`, every amount in a token's base
units. Selling one token for another is buying the other with it: selling USDC for SOL pays USDC
and buys SOL. On Solana USDC has 6 decimals and SOL 9, so `1000000000` is 1,000 USDC and also 1
SOL. A pool holds SOL wrapped, the mint the registry names `WSOL` (`sauce pools` takes `SOL` for it
too).

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

- **The program is staged.** It is about 6.3 KB, well past one transaction, so it runs from a code
  buffer it is written into first; `sauce run` does that ([Solana](solana.md)).
- **The accounts go through a lookup table.** Four slots and the shared accounts are 46 accounts;
  listed in the transaction they are over 1,500 bytes, and through an address lookup table one byte
  each. With the program staged and its accounts in a table, the cook is about 400 bytes.
- **About five pools fit.** Four distinct pools, the shared accounts and the cook's own come to
  about 52 accounts of 64; a fifth pool brings eight more, about 60. Measured on the venues' own
  programs: about 200,000 compute units with every slot empty, each pool that trades about 190,000
  more, each pool skipped after its reads about 70,000; four trading pools take about 950,000 of the
  1,400,000, and the five-slot program with four trading and one skipped about 1,030,000. Pools that
  share a program or a config cost fewer accounts.
- **Which pools, then.** The cook carries the four or five best the search found, the deepest and
  cheapest first. More pools than fit is more than one cook.

## Running it

Four steps, each a `sauce` command. Every amount is base units but the command's token amounts:
`--assume-balance USDC:1000` is 1,000 USDC in whole tokens (`USDC:1000000000n`, with a trailing `n`,
the same in base units).

1. **Find the pools and choose the slots.** `sauce pools --chain solana USDC WSOL --json` reads
   every pool of the pair at the venues above, deepest first, each with its `venue`, `pool`, `fee`,
   `liquidity`, its price both ways with the fee (`sides[].taker`, and as `maxPrice`), and `slots`:
   by the token paid, the nine accounts its slot takes. A pool the program skips is under `skipped`,
   with `why`; `checked` names each venue read. A venue that could not be read (an endpoint refusing
   the scan) leaves the listing partial, said in a note, and the command exits 1: run it again, or
   give an endpoint that answers `getProgramAccounts`. `--pay` chooses the slots, the deepest pools
   whose price with the fee is within `--max-price`, one a venue with `--per-venue` (to cover every
   venue with a pool within the limit), as many as `--slots` (4, the program's; 5 with a fifth
   slot), and prints `chosen` and `accounts`, ready for step 2:

   ```sh
   sauce pools --chain solana USDC WSOL --pay USDC --max-price 119047619047619047 --per-venue --json
   ```

   A pool deep enough may take the whole order, and the slots after it then trade nothing: that is
   the program spending within the limit, not a slot wasted.

2. **Write the accounts** as one JSON object for `--accounts` (each is also
   `--account NAME=<value>`; the forms are [Solana](solana.md)'s): `pot` is the Pot, which the Kitchen
   signs for; `pot:<token>` and `owner:<token>` the Pot's and the owner's associated token accounts;
   `mint:<token>` the mint; `program:<token>` its token program:

   ```json
   {
     "authority": "pot",
     "source": "pot:USDC",
     "output": "pot:WSOL",
     "recipient": "<your WSOL account>",
     "refund": "pot:USDC",
     "payMint": "mint:USDC",
     "buyMint": "mint:WSOL",
     "tokenProgram": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
     "token2022": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
     "memo": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
     "program0": "<slots.USDC.program of the first pool>",
     "pool0": "<…pool>",
     "config0": "<…config>",
     "vaultA0": "<…vaultA>",
     "vaultB0": "<…vaultB>",
     "extra0": "<…extra>",
     "ticks00": "<…ticks[0]>",
     "ticks01": "<…ticks[1]>",
     "ticks02": "<…ticks[2]>"
   }
   ```

   and the same nine for slots 1 to 3 (`program1` … `ticks32`): the `accounts` step 1 printed, or,
   by hand, slot `k` from a pool's `slots.<token paid>`, all nine the System program,
   `11111111111111111111111111111111`, for a slot with no pool. `refund` as `pot:USDC` keeps what is
   left in the Pot; `recipient` as `pot:WSOL` keeps what is bought there.

3. **Simulate**, with no key and nothing sent. The cook is past one transaction, so
   `sauce simulate` runs it in a local copy of every account it names, read from the cluster, with
   the released engine and Kitchen ([Solana](solana.md)): `--owner` is any wallet's address, or any
   address with no account, never a program's account such as a pool or a mint;
   `--assume-balance` gives the Pot's USDC account the budget in that copy. The program file is the
   example's, in the project (or run where the skill is installed):

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --accounts accounts.json --assume-balance USDC:1000 \
     --args 1000000000 120000000000000000 0 0
   ```

   Simulate once with `minTokens` and `maxAvgPrice` 0 to read what fills and its average, once with
   `minTokens` above what filled, once with `maxAvgPrice` below the average; then set them by the
   rules above. A simulation that reverts exits 1, its first line `The cook reverts: <reason>`, so
   hold each guard to its revert with `--expect-revert`, which exits 0 only when the cook reverts
   with that reason:

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --accounts accounts.json --assume-balance USDC:1000 \
     --args 1000000000 120000000000000000 8333333334 0 --expect-revert "bought below minTokens"
   ```

   and `--expect-revert "average too high"` for the average. Over MCP, `sauce_simulate`'s
   `scenarios`, each with its own `expectRevert`, simulate all three in local copies of one read of
   the cluster, at one slot. A token account the cluster does not have yet, such as a new Pot's WSOL
   account, the copy makes empty and a note names; `sauce run` creates it before the cook.

4. **Send** with `sauce run`, signed by the owner's `--keypair` (or `--wallet`), the budget already
   in the Pot's USDC account (a transfer into it from any wallet). `sauce run` creates the Pot and
   the token accounts the cook names that do not exist yet (asking first, or with `--yes`; the owner
   pays their rent), stages the program in a code buffer, creates an address lookup table holding
   the cook's accounts (it prints its address; a later cook naming the same accounts reuses it with
   `--lookup-table <address>`), simulates the staged cook, sends it, and closes the buffer:

   ```sh
   sauce run solana-distributed-swap.sauce.ts --chain solana --keypair <keypair> \
     --accounts accounts.json --args 1000000000 120000000000000000 8333333334 119750000000000000
   ```

   For another signer, `sauce tx` prints the cook as a plan of steps (setup, cook, the buffer's
   close) for `sauce send … --cursor <cursor>` ([Solana](solana.md)).

**Reading a simulation.** **A simulation counts only when it succeeds and `bought` is above 0**:
anything else (a failure, a revert, nothing bought, every slot the System program) is a failed
simulation to fix and run again, never a result. Buying SOL with 2,000 USDC, one pool deep enough
for all of it, the addresses as placeholders:

```text
The cook succeeds from <owner>: 354383 compute units, returns <the same three words, in hex>
main returns { spent: Uint256; bought: Uint256; unspent: Uint256 }: { spent: 2000000000, bought: 16983900131, unspent: 0 }
Simulated in a local copy (LiteSVM) of the 44 accounts the cook names, read from solana at slot <slot>, with the released engine and Kitchen: the cook does not fit one transaction, and no cluster can stage a program without sending. Nothing was signed or sent:
  the 6447-byte program staged into a code buffer in 10 transactions, as `sauce run` stages it
  the cook from that buffer, from the owner <owner>, which pays the Kitchen's execution fee of <fee> lamports
Token balance changes:
  <source> (source, the Pot's USDC account), owned by <Pot> (the Pot): -2000 USDC
  <recipient> (recipient), owned by <you>: +16.983900131 WSOL
  <vault> (vaultA0), owned by <pool> (pool0): -16.983900131 WSOL
  <vault> (vaultB0), owned by <pool> (pool0): +2000 USDC
```

- **`main returns`** names the three values: 2,000 USDC spent, 16.983900131 SOL bought, nothing
  unspent; the average, `spent × 1e18 ÷ bought`, is **117758582220433806**, 117.76 USDC per SOL.
- **Each pool that traded** shows its two vaults. A slot you filled and do not see sat out:
  missing, empty, skipped, past its limit, or the budget ran out first.
- **A partial fill** ends with what is left of the budget moving from `source` to `refund`.

## Pitfalls

- **Rewriting the program.** Use it whole; only add or drop slots.
- **A slot for the wrong direction.** A pool's slot depends on the token paid: take
  `slots.<token paid>` from `sauce pools`.
- **`source` or `output` not the authority's own.** Both must be the authority's accounts for the
  two mints.
- **A simulation that bought nothing taken as a result.** Only a success with `bought` above 0
  counts.
- **`maxPrice` given as a floor.** Turn a least-bought-per-unit limit over:
  `10^(18 + payDecimals − buyDecimals) ÷ floor`, rounded down.
- **More slots than fit.** Four, or five with the fifth slot; more is more than one cook.
- **A program's account as `--owner`** (a pool, a mint). The owner signs and pays: a wallet, or an
  address with no account.

## The venues, their pools and their slots

Every venue the distributed swap trades on, with its function in `@sauce/router`, where its pool
keeps what that function reads, the nine accounts its slot takes, and how to find a pair's pools. Offsets are bytes from the start of
the account; integers are little-endian, keys 32 bytes. A slot's accounts are, in order:

| #   | Slot account | What it is                                                              |
| --- | ------------ | ----------------------------------------------------------------------- |
| 0   | `program<k>` | the venue's program, which must own the pool                            |
| 1   | `pool<k>`    | the pool (a market, on Phoenix)                                         |
| 2   | `config<k>`  | the account the venue keeps the pool's settings in, where it has one    |
| 3   | `vaultA<k>`  | the pool's vault for its first token (token 0, token A, Phoenix's base) |
| 4   | `vaultB<k>`  | the pool's vault for its second token                                   |
| 5   | `extra<k>`   | one more account the venue's swap takes                                 |
| 6–8 | `ticks<k>0`… | the three tick arrays the swap walks, in walk order                     |

An account a venue does not take is the System program, `11111111111111111111111111111111`, and so
is every account of an unused slot. The concentrated-liquidity venues keep the pair in the order of
the two mints' 32-byte keys, the lower first: paying the lower-key token pushes the price down,
paying the other pushes it up, and the tick arrays the swap walks depend on which.

### Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble CLMM

One pool layout (1,544 bytes) and one swap, `swap_v2`, on four programs: `tryRaydiumClmm`,
`tryPancakeswapClmm`, `tryByreal` and `tryStabbleClmm`.

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

One pool layout (653 bytes): Orca's `swap_v2` (`tryOrcaWhirlpool`), and Cropper's `swap`, the
same without Token-2022 (`tryCropper`).

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

A pool of 423 bytes, a whirlpool's fields in another order, and its `swap` (`tryDefituna`):

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

A pool of 748 bytes and its `swap` (`tryCrema`):

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

An order book (`tryPhoenix`): a market account (its size varies with the book's) whose header
holds:

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

### Finding a pair's pools

A venue's pools are its program's accounts, so `getProgramAccounts` on the venue's program finds
them, with the pool's size and the pair at its mints' offsets as filters: for the
concentrated-liquidity venues the lower key at the first offset and the higher at the second, for
Phoenix the base and quote in either order. Then read each pool's liquidity, price and fee at the
offsets above, drop the empty ones and those whose fee is more than one rate, and keep the deepest
and cheapest, with the accounts its slot takes for the direction of the trade.

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
