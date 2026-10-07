---
name: sauce-solana-distributed-swap
description: Writing a Sauce program for Solana that spreads one exact-input swap over several price-limited pools as a limit order, never paying more than a maximum price for any unit, fees included, and never stranding input. Covers the rules (skip a missing, empty, paused or past-limit pool, a fee-adjusted limit per pool, minimum and average-price checks, refund only the unspent budget), pools found before the cook and passed as accounts, a venue read from its pool's owner, the nine-account slot per pool, every venue whose swap takes a price limit (Raydium CLMM, PancakeSwap CLMM, Byreal, Stabble CLMM, Orca Whirlpools, Cropper, DefiTuna, Crema, Phoenix) and those left out, a complete program over four pools, maxPrice, minTokens and maxAvgPrice for tokens of any decimals, compute units, accounts, lookup tables and running it. Use when asked for a distributed, split or multi-venue swap on Solana, "swap across Raydium and Orca", "buy SOL up to a price", a limit order, or one trade routed through several Solana pools.
---

# A distributed swap on Solana: one limit order over several pools

The caller gives **one price: the most they pay for any unit, fees included**. Every pool trades
until its own price reaches that price, and the budget it does not take stays for the next pool.
The price does the splitting: the program never computes an amount per pool and never sorts. The
rules are the same as on an EVM chain (`sauce-distributed-swap`); what Solana changes is how the
pools reach the program, how each is read and swapped, and what fits in one transaction.

## The rules

A correct distributed swap on Solana, whatever its tokens or venues:

1. **Takes its pools as accounts, found before the cook.** A Solana transaction lists every account
   it touches before it runs, so a program cannot ask a factory for a pool the way an EVM program
   does: the pools are found first (see "Finding a pair's pools") and passed in, each in a slot of
   nine accounts. The program trusts none of it. **A pool's venue is the program that owns it**
   (`pool.owner`), so the program reads that, refuses a pool no venue it knows owns, refuses a slot
   whose program is not the pool's owner, and refuses a pool that is not the pair.
2. **Skips a missing slot, an empty pool, a pool already past its own limit, and one whose fee is
   not one rate.** A slot with no pool is the System program in all nine accounts. A pool with no
   liquidity at its price has nothing to sell. A pool whose price is at or past its own limit has
   nothing to sell within it, and handed such a limit a venue fails the whole cook (Raydium's
   `SqrtPriceLimitOverflow`, Orca's `InvalidSqrtPriceLimitDirection`, Crema's
   `WrongSqrtPriceLimit`). A pool with swaps switched off, a paused pool and a market that is not
   open would fail it too. A dynamic fee, an adaptive fee, or a Byreal pool's decay, imbalance or
   own fee rate is more than the rate the limit is adjusted for, so the program skips that pool
   rather than pay past `maxPrice`.
3. **Gives each pool its own limit, adjusted for its fee.** A concentrated-liquidity pool takes its
   fee from the input, so its last unit costs its price divided by `1 − fee`: each pool's limit is
   the caller's sqrt price moved toward the trade by `√(1 − fee)`, **`limit ÷ √(1 − fee)` paying
   the lower-key token, `limit × √(1 − fee)` paying the other**. An order book charges its fee on
   top, so its limit price is `maxPrice ÷ (1 + fee)`. The pool's last unit, fee paid, then costs
   exactly `maxPrice`, and every earlier unit less. The fee is read from the pool or its config in
   the cook.
4. **Offers each pool everything still unspent** and lets the limit stop it. Every venue here takes
   only what it swapped before its price reached the limit, and leaves the rest in the paying
   account: nothing is stranded, and nothing needs measuring per pool.
5. **Checks the total**: at least `minTokens` bought, and an average no dearer than `maxAvgPrice`.
6. **Refunds only what is left of the budget**, to `refund`: never the account's whole balance,
   which may hold more of the token for other uses. What was bought goes on to `recipient`.

**One helper per pool; `main` only hands slots over.** Everything a pool needs, whatever its venue,
is the same: read it, skip it or work out its limit, swap. Write that once, as `trade`, which takes
the slot's accounts and the accounts every swap shares as two `Account[]` arrays, reads the pool's
owner, and branches only where venues differ: where the price, liquidity, fee and mints are, and
how the swap's data and accounts are laid out. A slot is an array because a function other than
`main` keeps at most about sixteen values in use at once (`sauce-script`).

**Why no sorting.** A pool trades only while its price, after its fee, beats `maxPrice`, so every
unit any pool sells is within it, in any order. The order decides only which pool gets the budget
when it runs out before every pool reaches its limit: put the deepest, cheapest pool first. With
enough budget for every pool to reach its limit, every pool's last unit costs the same, exactly
`maxPrice`.

## The venues

Every Solana venue the package knows whose swap takes a price limit that stops the swap and leaves
the rest of the input, checked by running each venue's own program:

| Venue            | Program                                        | Swap                                    |
| ---------------- | ---------------------------------------------- | --------------------------------------- |
| Raydium CLMM     | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | `swap_v2`, a sqrt price limit           |
| PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` | the same, on Raydium's code             |
| Byreal           | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2`  | the same, on Raydium's code             |
| Stabble CLMM     | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` | the same, on Raydium's code             |
| Orca Whirlpools  | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`  | `swap_v2`, a sqrt price limit           |
| Cropper          | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` | `swap` on Orca's code (it has no v2)    |
| DefiTuna         | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9`  | `swap`, a sqrt price limit              |
| Crema            | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` | `swap`, a sqrt price limit              |
| Phoenix          | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`  | an immediate-or-cancel order at a price |

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
[references/venues.md](references/venues.md).

## The program

[examples/solana-distributed-swap.sauce.ts](examples/solana-distributed-swap.sauce.ts) is one
complete implementation of those rules, over four slots, any venue in each; its header gives every
input with its units and how to run it. **Use its code whole**: the venue code is each venue's byte
layout, instruction format and account order, which nothing else gives and no program can do
without. Write the file's header for the task, fill the slots and pass the inputs; change the code
only to add or drop a slot (below). Its code:

```sauce chain=solana
// The venues. A pool is an account of its venue's program, so its owner says how to read and swap
// it. Raydium CLMM and the three programs built on its code share one pool layout and one swap.
const RAYDIUM_CLMM = 0xa5d5ca9e04cf5db590b714ba2fe32cb159133fc1c192b72257fd07d39cb0401e; // CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK
const PANCAKESWAP_CLMM = 0xf9ddcb1fe2f88ebbac5f5b97b4b90ad49551962b89419d765284622845e41cf8; // HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq
const BYREAL = 0x0634d20f1bf56dd164e3c13c7836a4229ec5ab21ff54528390a51789f3cdbbdb; // REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2
const STABBLE_CLMM = 0x539a8f14242a332eff95ba037c2c3936689d09da4571718f89491b86302586a3; // 6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6
// Orca Whirlpools, and Cropper, built on its code with only its first swap.
const ORCA_WHIRLPOOL = 0x0e03685f8e909053e458121c66f5a76aedc7706aa11c82f8aa952a8f2b7879a9; // whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
const CROPPER = 0xefa6e5dfb789ce3db66eccedff9eab02ca6a57cf068746befe835ab4c2f2ee0f; // H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt
const DEFITUNA = 0x09db19e5e1ffb1eba60fcffdafaa314664a12f6cac8af15485b5ddd92b6f3ae6; // fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9
const CREMA = 0xa865993892793f8063d3199efd7fbda5844e3a99b4c73ce660916534b64e4ce6; // CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR
// Phoenix, an order book: a market fills an order at its limit price or better, then stops.
const PHOENIX = 0x05d0ea4f33737013a563e09348edb6f4593d91fc7641f9247c2441a842a1bbeb; // PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY

// One pool: skipped when missing, empty or already past its own limit, else offered all of the
// budget still unspent, up to its own limit. `slot`: the pool's nine accounts. `shared`: authority,
// source, output, payMint, buyMint, the two token programs and the memo program.
function trade(
  slot: Account[],
  shared: Account[],
  kept: Uint256,
  limit: Uint256,
  maxPrice: Uint256,
): void {
  const pool = slot[1];
  if (pool.address == 0) {
    return;
  }
  const source = shared[1];
  const output = shared[2];
  const pay = shared[3].address;
  const buy = shared[4].address;
  const unspent = balanceOf(pay, source) - kept;
  if (unspent == 0) {
    return;
  }
  const venue = pool.owner;
  require(slot[0].address == venue, "a pool's program is not its owner");

  if (venue == PHOENIX) {
    // An order book: base and quote in the market's header, prices in ticks, the fee on top.
    if (svm.sload(pool, 8, 8).toLe() != 1) {
      return; // not open for taking: post-only, paused or closed
    }
    const paysBase = svm.sload(pool, 48, 32).toBe() == pay;
    require(svm.sload(pool, paysBase ? 128 : 48, 32).toBe() == buy, "market is not the pair");
    const fee = svm.sload(pool, 856, 8).toLe();
    const baseLot = svm.sload(pool, 112, 8).toLe();
    const quoteLot = svm.sload(pool, 192, 8).toLe();
    // One tick, in maxPrice's units: quote atoms per base atom, times 10^18.
    const tick = Math.mulDiv(
      svm.sload(pool, 840, 8).toLe() * quoteLot,
      10 ** 18,
      svm.sload(pool, 832, 8).toLe() * baseLot,
    );
    // Buying base: the most a base atom may cost before the fee. Selling it: the least it must
    // fetch before the fee is taken, rounded up.
    let ticks = Math.mulDiv(maxPrice, 10000, (10000 + fee) * tick);
    let side = hex`000200`;
    if (paysBase) {
      ticks = Math.mulDiv(10 ** 36, 10000, maxPrice * (10000 - fee) * tick) + 1;
      side = hex`000201`;
    }
    // Every lot still unspent, of the token it pays: base lots selling base, quote lots buying it.
    const lots = unspent / (paysBase ? baseLot : quoteLot);
    if (lots == 0) {
      return;
    }
    // Swap: an immediate-or-cancel order at `ticks`, for every lot still unspent.
    // No minimum fill, a self-trade cancels the resting order, no match limit, client id 0, no
    // deposited funds, no expiry.
    const spend = lots.toBytesLe(8);
    const noLots = hex`0000000000000000`;
    const none = hex`00000000000000000000000000000000`;
    const order = side.concat(
      hex`01`,
      ticks.toBytesLe(8),
      paysBase ? spend : noLots,
      paysBase ? noLots : spend,
    );
    const rest = none.concat(hex`0100`, none, hex`000000`);
    const baseAccount = paysBase ? source : output;
    const quoteAccount = paysBase ? output : source;
    svm.call(
      slot[0],
      [slot[0], slot[2], pool, shared[0], baseAccount, quoteAccount, slot[3], slot[4], shared[5]],
      order.concat(rest),
    );
    return;
  }

  // The concentrated-liquidity venues: the pair in key order, the price a Q64.64 square root of
  // the higher-key token per lower-key token, the fee in millionths taken from the input.
  const paysA = pay < buy;
  let mintA = 0;
  let mintB = 0;
  let liquidity = 0;
  let price = 0;
  let fee = 0;
  if (
    venue == RAYDIUM_CLMM ||
    venue == PANCAKESWAP_CLMM ||
    venue == BYREAL ||
    venue == STABBLE_CLMM
  ) {
    // Swaps off (status bit 4), or fees on top of the config's rate, which Byreal's pools may set
    // (a pool rate at 393, decay, imbalance and dynamic fees from 1096): not one rate to adjust for.
    const status = svm.sload(pool, 389, 1).toLe();
    if (
      (status & 16) != 0 ||
      svm.sload(pool, 393, 4).toLe() != 0 ||
      svm.sload(pool, 1096, 16).toLe() != 0
    ) {
      return;
    }
    mintA = svm.sload(pool, 73, 32).toBe();
    mintB = svm.sload(pool, 105, 32).toBe();
    liquidity = svm.sload(pool, 237, 16).toLe();
    price = svm.sload(pool, 253, 16).toLe();
    fee = svm.sload(slot[2], 47, 4).toLe();
  } else if (venue == ORCA_WHIRLPOOL || venue == CROPPER) {
    if (svm.sload(pool, 41, 2).toLe() != svm.sload(pool, 43, 2).toLe()) {
      return; // an adaptive fee: it rises with volatility, past the rate the pool shows
    }
    mintA = svm.sload(pool, 101, 32).toBe();
    mintB = svm.sload(pool, 181, 32).toBe();
    liquidity = svm.sload(pool, 49, 16).toLe();
    price = svm.sload(pool, 65, 16).toLe();
    fee = svm.sload(pool, 45, 2).toLe();
  } else if (venue == DEFITUNA) {
    mintA = svm.sload(pool, 11, 32).toBe();
    mintB = svm.sload(pool, 43, 32).toBe();
    liquidity = svm.sload(pool, 151, 16).toLe();
    price = svm.sload(pool, 167, 16).toLe();
    fee = svm.sload(pool, 143, 2).toLe();
  } else if (venue == CREMA) {
    if (svm.sload(pool, 747, 1).toLe() != 0) {
      return; // paused
    }
    mintA = svm.sload(pool, 40, 32).toBe();
    mintB = svm.sload(pool, 72, 32).toBe();
    liquidity = svm.sload(pool, 174, 16).toLe();
    price = svm.sload(pool, 190, 16).toLe();
    fee = svm.sload(pool, 172, 2).toLe();
  } else {
    throw "not a supported venue's pool";
  }
  require(mintA == (paysA ? pay : buy) && mintB == (paysA ? buy : pay), "pool is not the pair");
  // The pool's own limit: the caller's moved by √(1 − fee), so that its last unit, fee paid,
  // costs exactly maxPrice. Paying the lower-key token pushes the price down, the other up.
  const root = Math.sqrt((1000000 - fee) * 10 ** 30); // √(1 − fee), times 1e18
  const own = paysA ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);
  const better = paysA ? price > own : price < own;
  if (liquidity == 0 || !better) {
    return;
  }

  // Swap: exact input, everything unspent, up to `own`. The vaults and the owner's accounts in the
  // pool's token order; a whirlpool's direction is "A to B", true when paying the lower-key token.
  const payMint = shared[3];
  const buyMint = shared[4];
  const ownerA = paysA ? source : output;
  const ownerB = paysA ? output : source;
  const mintAccountA = paysA ? payMint : buyMint;
  const mintAccountB = paysA ? buyMint : payMint;
  const programA = mintAccountA.owner == shared[6].address ? shared[6] : shared[5];
  const programB = mintAccountB.owner == shared[6].address ? shared[6] : shared[5];
  const aToB = paysA ? hex`01` : hex`00`;
  const amount = unspent.toBytesLe(8);
  const none = hex`0000000000000000`;
  const bound = own.toBytesLe(16);
  if (venue == ORCA_WHIRLPOOL) {
    const swapV2 = hex`2b04ed0b1ac91e62`;
    const data = swapV2.concat(amount, none, bound, hex`01`, aToB, hex`00`);
    svm.call(
      slot[0],
      [
        programA,
        programB,
        shared[7],
        shared[0],
        pool,
        mintAccountA,
        mintAccountB,
        ownerA,
        slot[3],
        ownerB,
        slot[4],
        slot[6],
        slot[7],
        slot[8],
        slot[5],
      ],
      data,
    );
  } else if (venue == CROPPER) {
    const swap = hex`f8c69e91e17587c8`;
    const data = swap.concat(amount, none, bound, hex`01`, aToB);
    svm.call(
      slot[0],
      [
        shared[5],
        shared[0],
        pool,
        ownerA,
        slot[3],
        ownerB,
        slot[4],
        slot[6],
        slot[7],
        slot[8],
        slot[5],
      ],
      data,
    );
  } else if (venue == DEFITUNA) {
    const swap = hex`f8c69e91e17587c8`;
    const data = swap.concat(amount, none, bound, hex`01`, aToB, hex`00`);
    svm.call(
      slot[0],
      [
        programA,
        programB,
        shared[7],
        shared[0],
        pool,
        mintAccountA,
        mintAccountB,
        ownerA,
        ownerB,
        slot[3],
        slot[4],
        slot[6],
        slot[7],
        slot[8],
      ],
      data,
    );
  } else if (venue == CREMA) {
    const swap = hex`f8c69e91e17587c8`;
    const data = swap.concat(aToB, hex`01`, amount, none, bound);
    svm.call(
      slot[0],
      [
        slot[2],
        pool,
        mintAccountA,
        mintAccountB,
        ownerA,
        ownerB,
        slot[3],
        slot[4],
        slot[5],
        shared[0],
        shared[5],
        slot[6],
        slot[7],
        slot[8],
      ],
      data,
    );
  } else {
    // Raydium's layout: the input and output vault, token program, Token-2022 and the memo
    // program, both mints, then the tick arrays.
    const swapV2 = hex`2b04ed0b1ac91e62`;
    const data = swapV2.concat(amount, none, bound, hex`01`);
    const vaultIn = paysA ? slot[3] : slot[4];
    const vaultOut = paysA ? slot[4] : slot[3];
    svm.call(
      slot[0],
      [
        shared[0],
        slot[2],
        pool,
        source,
        output,
        vaultIn,
        vaultOut,
        slot[5],
        shared[5],
        shared[6],
        shared[7],
        payMint,
        buyMint,
        slot[6],
        slot[7],
        slot[8],
      ],
      data,
    );
  }
}

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

  // maxPrice as a pool's sqrt price (the higher-key token per the lower-key one, times 2^64).
  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1 << 128, 10 ** 18));
  if (pay < buy) {
    limit = Math.sqrt(Math.mulDiv(1 << 128, 10 ** 18, maxPrice));
  }

  // Each slot in turn; trade() decides and swaps.
  const shared = [authority, source, output, payMint, buyMint, tokenProgram, token2022, memo];
  trade(
    [program0, pool0, config0, vaultA0, vaultB0, extra0, ticks00, ticks01, ticks02],
    shared,
    kept,
    limit,
    maxPrice,
  );
  trade(
    [program1, pool1, config1, vaultA1, vaultB1, extra1, ticks10, ticks11, ticks12],
    shared,
    kept,
    limit,
    maxPrice,
  );
  trade(
    [program2, pool2, config2, vaultA2, vaultB2, extra2, ticks20, ticks21, ticks22],
    shared,
    kept,
    limit,
    maxPrice,
  );
  trade(
    [program3, pool3, config3, vaultA3, vaultB3, extra3, ticks30, ticks31, ticks32],
    shared,
    kept,
    limit,
    maxPrice,
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

Step by step:

- **Inputs.** The amounts are `main`'s last four parameters, passed with `--args`: `budget`,
  `maxPrice`, `minTokens` and `maxAvgPrice`. Everything else is an account: the two mints, the
  accounts the tokens move through, the programs a swap needs, and four slots. The program names no
  token, so one file buys any token with any other, SPL or Token-2022.
- **The paying side.** `authority` signs for `source` and `output`, the paying and the receiving
  token accounts. Through the Kitchen it is the Pot (`pot`), which holds them; cooked directly on
  the engine (`--via engine`) it is the signer's own wallet. Both accounts must be the authority's
  own: Crema and Phoenix pay only into the trader's own account. `kept` is whatever else of the
  paying token `source` holds, so only the budget is ever offered or refunded.
- **`maxPrice` as a sqrt price.** A concentrated-liquidity pool's price is the square root of the
  higher-key token per lower-key token, times 2^64 (the pair in the order of their 32-byte keys).
  Paying the higher-key token, `limit` is `√(maxPrice × 2^128 ÷ 1e18)`; paying the lower-key one,
  the price is upside down, `√(2^128 × 1e18 ÷ maxPrice)`.
- **`trade`** returns at once for a missing slot or a spent budget. It requires the slot's program
  to be the pool's owner, and branches on that owner. A concentrated-liquidity pool: it skips one
  whose fee is more than one rate or whose swaps are off, reads the mints and requires the pair,
  reads the liquidity, price and fee, works out the pool's own limit, skips an empty pool or one
  not better than that limit, and swaps every unit still unspent up to it. The root is rounded
  down, so each limit sits a hair inside the exact one: the pool stops a little sooner, never
  later. Phoenix: it skips a market not open for taking, requires the pair, turns `maxPrice` into a
  limit in ticks less the taker fee, and places an immediate-or-cancel order for every lot still
  unspent; offers past the limit are left on the book, and a book entirely past it fills nothing.
- **Swap.** Each venue's own instruction, by `svm.call`, with the pool's own limit and no minimum
  output of its own: the totals are checked once, after the slots. `aToB` (a whirlpool's
  direction) is true paying the lower-key token. Raydium's layout takes the input vault and mint
  first; a whirlpool, DefiTuna and Crema take token A's accounts first whatever the direction.
- **Settle.** A `require` reverts the whole cook, every swap included. What was bought goes from
  `output` to `recipient` (when they differ), and what is left of the budget from `source` to
  `refund` (when they differ), both with `transferChecked`, so Token-2022 mints move too. `main`
  returns `{ spent, bought, unspent }`: the cook returns it as three words, and `sauce simulate`
  prints it by name.

**A fifth slot, or fewer.** A slot is nine `main` parameters and one `trade` call. To add one,
declare after `ticks32`, as slot 3's are:

```text
program4: Account, pool4: Account<Writable>, config4: Account, vaultA4: Account<Writable>,
vaultB4: Account<Writable>, extra4: Account<Writable>, ticks40: Account<Writable>,
ticks41: Account<Writable>, ticks42: Account<Writable>,
```

and call `trade([program4, pool4, config4, vaultA4, vaultB4, extra4, ticks40, ticks41, ticks42],
shared, kept, limit, maxPrice)` after the fourth call.
[examples/solana-distributed-swap-5.sauce.ts](examples/solana-distributed-swap-5.sauce.ts) is the
program with that slot, ready to use whole as the four-slot one is (`sauce pools … --slots 5` fills
it). Five fit one cook ("What fits in one cook"). To drop one, remove its parameters and its call;
an unused slot can also stay, all nine the System program.

**The skips are reads, never failures.** A venue fails the whole cook on a limit on the wrong side
of its price, on a paused pool and on a closed market, so the program checks each before calling
it. A missing pool is never read at all.

## Inputs and units

`main(… accounts …, budget, maxPrice, minTokens, maxAvgPrice)`, every amount in a token's base
units. Selling one token for another is buying the other with it: selling USDC for SOL pays USDC
and buys SOL. On Solana USDC has 6 decimals and SOL 9, so `1000000000` is 1,000 USDC and `1000000000` is
also 1 SOL. A pool holds SOL wrapped, the mint the registry names `WSOL` (`sauce pools` takes `SOL`
for it too).

**`maxPrice`** is payToken base units per buyToken base unit, times 1e18:

`maxPrice = price × 10^(18 + payDecimals − buyDecimals)`, with `price` in whole payToken per whole
buyToken. Paying USDC (6) for SOL (9), that is the price × 10^15.

| Trade                                   | Price                    | `maxPrice`              |
| --------------------------------------- | ------------------------ | ----------------------- |
| Buy SOL with USDC                       | at most 120 USDC         | **120000000000000000**  |
| Buy SOL with USDC, at a floor           | at least 0.0084 SOL each | **119047619047619047**  |
| Buy USDC with SOL (sell SOL at a floor) | at least 118 USDC        | **8474576271186440677** |

**A floor is a ceiling turned over.** `maxPrice` is always what one unit bought may cost, in the
token paid. A limit given the other way, as the least bought per unit paid ("never below 0.0084 SOL
per USDC"), is its inverse: `maxPrice = 10^(18 + payDecimals − buyDecimals) ÷ floor`, rounded down
so no unit fills below the floor. Paying USDC for SOL at 0.0084: `10^15 ÷ 0.0084`, 119.047619 USDC
per SOL. The third row is the same: 1 SOL for at least 118 USDC is at most `1 ÷ 118` SOL per USDC,
so `10^9 × 1e18 ÷ (118 × 10^6)`, rounded down. `maxAvgPrice` is in the same units; `0` turns it off.

**`minTokens`, consistent with `maxPrice`.** Every unit costs `maxPrice` or less, so spending the
whole budget buys at least `budget × 1e18 ÷ maxPrice`:

- **To spend all of the budget or nothing**: `minTokens = budget × 1e18 ÷ maxPrice`, rounded up.
  Buying SOL with 1,000 USDC at most 120: `8333333334` (8.333333334 SOL).
- **To buy as much as fills within `maxPrice`**: `minTokens` is the least worth the fees, or `0`,
  and the rest of the budget comes back.

**`maxAvgPrice`, from a rehearsal.** Rehearse with `maxAvgPrice` 0, read the average from what
`main` returns (`spent × 1e18 ÷ bought`, in `maxPrice`'s units), and set `maxAvgPrice` halfway from
that average to `maxPrice`, rounded up. A rehearsal averaging 119.5 USDC per SOL with `maxPrice`
120 gives 119.75, **119750000000000000**.

**Getting the price right.** The reference is the best price a buyer pays, fee included, among
pools deep enough for the order: a pool's price divided by `1 − fee` paying the higher-key token,
and the same upside down paying the other. `maxPrice` is that reference plus the slippage you
accept, kept tight: a loose `maxPrice` reaches thin, dear pools, and a `maxPrice` at or below the
best price trades nothing and refunds the whole budget, without reverting. Solana's pool prices
differ between venues more than an EVM chain's: a thin pool can sit a percent or two away from the
deep ones, and an order book's offers further still.

## What fits in one cook

A cook is one Solana transaction: at most 1,232 bytes and 64 accounts, and 1,400,000 compute units.

- **The program is staged.** It is about 6.5 KB, well past one transaction, so it runs from a code
  buffer it is written into first; `sauce run` does that (`sauce-solana`).
- **The accounts go through a lookup table.** Four slots and the shared accounts are 46 accounts;
  listed in the transaction they are over 1,500 bytes, and through an address lookup table one byte
  each. With the program staged and its accounts in a table, the cook is about 400 bytes.
- **About five pools fit.** Four distinct pools, the shared accounts and the cook's own come to
  about 52 accounts of 64; a fifth pool brings eight more, about 60. Measured on the venues' own
  programs, the program costs about 190,000 compute units with every slot empty, each pool that
  trades about 210,000 more, and each pool skipped after its reads about 75,000: four trading
  pools take about 1,000,000 of the 1,400,000, and the five-slot program with four trading and one
  skipped about 1,080,000. Pools that share a program or a config cost fewer accounts.
- **Which pools, then.** On Solana the program does not walk every pool there is: the cook carries
  the four or five best the search found, the deepest and cheapest first. More pools than fit is
  more than one cook.

## Running it

Four steps, each a `sauce` command: find the pools, rehearse with no key, then send. Every
amount is base units but the command's token amounts. `--assume-balance <token>:<amount>` gives
the account the cook spends that token from (the Pot's) that balance, in the rehearsal only, the
amount in whole tokens: `--assume-balance USDC:1000` is 1,000 USDC, and `USDC:1000000000n`, with
a trailing `n`, the same in base units.

1. **Find the pools and choose the slots.** `sauce pools --chain solana USDC WSOL --json` reads
   every pool of the pair at the venues above, by liquidity at its price, deepest first, each with
   its `venue`, `pool`, `fee`, `liquidity`, its price both ways with the fee (`sides[].taker`, and
   as `maxPrice`), and `slots`: by the token paid, the nine accounts its slot takes. A pool the
   program skips is under `skipped`, with `why`, and so is an order book whose offers are all far
   from the pair's price; `checked` names each venue read. A venue that could not be read (an
   endpoint refusing the scan) leaves the listing partial, said in a note, and the command exits
   1: run it again, or give an endpoint that answers `getProgramAccounts`. `--pay` chooses the
   slots, the deepest pools whose price with the fee is within `--max-price`, one a venue with
   `--per-venue` (to cover every venue that has a pool within the limit), as many as `--slots`
   (4, the program's; 5 with a fifth slot), and prints `chosen` and `accounts`, the slots'
   accounts ready for step 2:

   ```sh
   sauce pools --chain solana USDC WSOL --pay USDC --max-price 119047619047619047 --per-venue --json
   ```

   A pool deep enough may take the whole order, and the slots after it then trade nothing: that is
   the program spending within the limit, not a slot wasted. A rehearsal whose slots are all the
   System program trades nothing and returns the whole budget, so check what `bought` says.

2. **Write the accounts** as one JSON object, which `--accounts` takes (each is also
   `--account NAME=<value>`). A value is an address or a form the command resolves, a token being
   a symbol the chain registers or a base58 mint: `pot` is the Pot, which the Kitchen signs for;
   `owner` the owner; `pot:<token>` the Pot's associated token account for the token, as
   `pot:USDC`; `owner:<token>` the owner's, as `owner:WSOL`; `mint:<token>` the token's mint, as
   `mint:USDC`; and `program:<token>` its token program, SPL Token or Token-2022, as
   `program:USDC`:

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
   by hand, slot `k` from a pool's `slots.<token paid>` (`program<k>` its `program`, then `pool`,
   `config`, `vaultA`, `vaultB` and `extra`, and `ticks<k>0` to `ticks<k>2` its `ticks`), all nine
   the System program, `11111111111111111111111111111111`, for a slot with no pool. `refund` as
   `pot:USDC` keeps what is left in the Pot (the program then moves nothing back); `recipient` as
   `pot:WSOL` keeps what is bought there.

3. **Rehearse**, with no key and nothing sent. The cook is past one transaction, so `sauce simulate`
   runs it in a local copy of every account it names, read from the cluster, with the released
   engine and Kitchen: the program staged as `sauce run` stages it, the Pot created there if it is
   missing, and the owner given the lamports the staging and the fees take: `--owner` is any wallet's
   address, or any address with no account at all, never a program's account such as a pool or a
   mint (the owner signs and pays). `--assume-balance` gives the Pot's USDC account the budget in
   that copy (token balances only). The program file is the example's, copied into the project
   (or run where the skill is installed):

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --accounts accounts.json --assume-balance USDC:1000 \
     --args 1000000000 120000000000000000 0 0
   ```

   Rehearse once with `minTokens` and `maxAvgPrice` 0 to read what fills and its average, once with
   `minTokens` above what filled, once with `maxAvgPrice` below the average; then set them by the
   rules above. A rehearsal that reverts exits 1, its first line `The cook reverts: <reason>`, so
   hold each guard's to its revert with `--expect-revert`, which exits 0 only when the cook reverts
   with that reason:

   ```sh
   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
     --accounts accounts.json --assume-balance USDC:1000 \
     --args 1000000000 120000000000000000 8333333334 0 --expect-revert "bought below minTokens"
   ```

   and `--expect-revert "average too high"` for the average. Over MCP, `sauce_simulate`'s
   `scenarios`, each with its own `expectRevert`, rehearse all three in local copies of one read
   of the cluster, at one slot. A token account the cluster does not have yet, such as a new Pot's
   WSOL account, the copy makes empty and a note names; `sauce run` creates it before the cook.

4. **Send** with `sauce run`, signed by the owner's `--keypair` (or `--wallet`). The budget must be
   in the Pot's USDC account first: a transfer into it from any wallet. `sauce run` creates the Pot
   and the Pot's or owner's token accounts the cook names that do not exist yet (asking first, or
   with `--auto-approve`; the owner pays their rent), stages the
   program in a code buffer, creates an address lookup table holding the cook's accounts (it prints
   its address; a later cook naming the same accounts reuses it with `--lookup-table <address>`),
   rehearses the staged cook, sends it, and closes the buffer again:

   ```sh
   sauce run solana-distributed-swap.sauce.ts --chain solana --keypair <keypair> \
     --accounts accounts.json --args 1000000000 120000000000000000 8333333334 119750000000000000
   ```

`sauce tx` prints one unsigned transaction, and this cook is several: the staging, the table and
the cook. A signer other than the `sauce` command sends the same sequence, which the package's
TypeScript client builds (`sauce-typescript`).

**Reading a rehearsal.** `sauce simulate` prints what `main` returned, by name, how it rehearsed,
and what moved. **The order is rehearsed only when the rehearsal succeeds and `bought` is above
0**: anything else (a failure, a revert, nothing bought) is a failed rehearsal to fix and rehearse
again, never a result. Buying SOL with 2,000 USDC, one pool deep enough for all of it, the
addresses as placeholders:

```text
The cook succeeds from <owner>: 411038 compute units, returns <the same three words, in hex>
main returns { spent: Uint256; bought: Uint256; unspent: Uint256 }: { spent: 2000000000, bought: 16983900131, unspent: 0 }
Rehearsed in a local copy (LiteSVM) of the 44 accounts the cook names, read from solana at slot <slot>, with the released engine and Kitchen: the cook does not fit one transaction, and no cluster can stage a program without sending. Nothing was signed or sent:
  the 6507-byte program staged into a code buffer in 10 transactions, as `sauce run` stages it
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

## Before sending

- The slots hold the pair's best pools, deepest and cheapest first, each with the accounts its
  swap takes for this direction ([references/venues.md](references/venues.md)); an unused slot is
  the System program in all nine.
- `source` and `output` are the authority's own token accounts for the two mints; `recipient` and
  `refund` are where the bought tokens and the rest of the budget go.
- `maxPrice` is the best fee-inclusive price plus the slippage you accept, in payToken base units
  per buyToken base unit, times 1e18: `10^(18 + payDecimals − buyDecimals)` times the price.
- `minTokens` is `budget × 1e18 ÷ maxPrice`, rounded up, to spend everything; less to accept a
  partial fill. `maxAvgPrice` is halfway from a rehearsal's average to `maxPrice`.

[examples/solana-distributed-swap.mts](examples/solana-distributed-swap.mts) compiles the program
for Solana and pins this page to it: the code above, the venues and their program ids, the pool
layouts, `maxPrice`, `minTokens` and `maxAvgPrice`, and the accounts.
