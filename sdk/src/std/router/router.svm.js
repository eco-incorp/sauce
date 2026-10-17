// @sauce/router — SVM arm. One function per Solana venue whose swap takes a price limit, and
// Manifest's book.
//
// Every swap here is a LIMIT ORDER at one pool: it offers the pool up to `amountIn` of the token
// paid and lets the pool trade until its price reaches the limit; the pool takes only what it
// swapped before that and leaves the rest in the paying account, so nothing is stranded.
// Invariant's is the exception: its program refuses a swap that reaches its limit with input left
// (custom error 0x1778), which aborts the whole transaction, so there the input must fit inside the
// limit. Every swap is EXACT INPUT up to the limit: nothing here can express an exact-output swap.
// Every function takes RUN-TIME arguments. There are four forms of each venue's swap:
//
//   <venue>(slot, trader, amountIn, priceLimit, minOut, recipient, stop)  at a price
//   <venue>AtLimit(slot, trader, amountIn, limit, minOut, recipient)      at the pool's own limit
//   <venue>Cpi(program, accounts, source, amountIn, limit, …)             its instruction alone
//   <venue>Data(amountIn, limit, …)                                       its instruction's data
//
// The first form is the nine venues' (Raydium CLMM, PancakeSwap CLMM, Byreal, Stabble CLMM, Orca
// Whirlpools, Cropper, DefiTuna, Crema, Phoenix); the
// other three are theirs and Invariant's and OpenBook v2's, which take `priceLots` and `orders` in
// place of `limit`; Manifest's swap takes no limit, so its functions (`manifest`, `manifestCpi`,
// `manifestData`) take none. Orca has two data functions, its classic `swap`'s
// (`orcaWhirlpoolData`) and `swap_v2`'s (`orcaWhirlpoolV2Data`), and OpenBook a second that takes
// the order in lots, divided already (`openbookV2LotsData`). The first two forms return what the
// recipient received, or 0 having moved nothing (SKIPS, below); `…Cpi` what the paying account
// paid; `…Data` the bytes. Every form sends the
// same instruction for the same amount, limit and floor, Orca's excepted: at a price every pool's
// swap is `swap_v2`, and at its own limit a pool of two SPL Token mints takes the classic `swap`. The
// `…AtLimit` forms build it with `…Data`. The forms at a price write it themselves and check none
// of its fields: their floor is 0 and their limit fits, so no check of `…Data`'s could fail there,
// and every program swapping at a price would carry them. `…Cpi` writes the same bytes itself too,
// because a call into `…Data` would cost it about 2k compute units (Phoenix's excepted, which is
// cheaper through `phoenixData`).
//
// `slot` is the pool's accounts, in this order (an account a venue does not take is the System
// program, `11111111111111111111111111111111`):
//
//   0 program   the venue's program, which must own the pool
//   1 pool      the pool (a market, on Phoenix, Manifest and OpenBook)
//   2 config    the account the venue keeps the pool's settings in, where it has one
//   3 vaultA    the pool's vault for its first token (token 0, token A, Invariant's X, a market's base)
//   4 vaultB    the pool's vault for its second token
//   5 extra     one more account the venue's swap takes
//   6–8 ticks   the tick arrays the swap walks, in walk order
//   9…          the accounts some venues take past those
//
// Past the nine: at its own limit, a Raydium-layout pool's slot may carry, tenth, its tick-array
// bitmap extension, which its swap reads past the pool's default range (a slot of nine, or the System
// program there, sends none, and so does every form at a price); Invariant's carries its program's authority (its `config` is the program's state,
// `extra` the pool's tickmap, its ticks the tick accounts the swap may cross); OpenBook v2's its two
// oracles (the program itself for one the market has not; its `config` is the market's authority,
// `extra` its event heap, its ticks its bids, its asks and the System program). An Orca pool's
// `extra`, its oracle, must be writable at a price, where its swap is `swap_v2`, which declares it
// writable whatever the fee; at its own limit, for an adaptive fee and a Token-2022 mint. Crema's
// swap refuses a
// tick array its map does not mark, and Invariant's takes only the ticks it crosses, so each is passed
// its slot's first tick array and each after it until a System program. Manifest's `config` is the
// System program, which its swap takes.
//
// `trader` is the accounts every swap shares: the authority that signs for the paying account (the
// Pot, through the Kitchen), the paying token account (`source`), the two mints (`payMint`, then
// `buyMint`), the SPL Token and Token-2022 programs and the memo program, in that order. Manifest and
// OpenBook take the authority as their payer, so there it must be writable. `recipient` is the token
// account the output lands in; Crema and Phoenix pay only into the authority's own.
// `amountIn` is in the paid token's base units, and `minOut` the least the recipient may receive from
// a swap that ran; below it the whole program reverts.
//
// AT A PRICE. `priceLimit` is the most one unit bought may cost, fee included, as payToken base units
// per buyToken base unit times 1e18. A concentrated-liquidity pool's price is a Q64.64 square root of
// the higher-key token per lower-key token (the pair in the order of the mints' 32-byte keys), and it
// takes its fee from the input, so its last unit costs its price divided by `1 − fee`. Each function
// reads the pool's fee and moves `priceLimit`'s square root toward the trade by `√(1 − fee)`: the
// pool's last unit, fee paid, then costs at most `priceLimit`, and every earlier unit less. A Phoenix
// market charges its taker fee on top, so its limit price is `priceLimit ÷ (1 + fee)`, in the market's
// ticks. A pool whose fee is more than one rate, which no such limit can hold, is skipped. And no
// concentrated-liquidity swap at a price walks past the tick arrays its slot gives it, where its
// program would fail the whole transaction: its limit is held a tick inside them (below, "The window
// a swap at a price walks"). `stop`, on the eight concentrated-liquidity venues, is a tick the cook's
// builder read from the pool's tick arrays as it built the cook, the swap holding a tick inside it:
// 0 is none, 1 skips the pool, and any other value is the tick as the window's are (its i32 with the
// sign bit flipped), on Raydium's code with the slot place of the tick array it lies in from bit 40.
// Nearer than the window it holds the swap within the pool's share of the cook's compute units,
// which a pool crossing many initialized ticks runs out of, failing the transaction; further, it
// takes the swap on into the furthest tick array the slot gives, to an initialized tick there that
// the swap reads as it runs. 0 costs one comparison; a caller computing none passes it.
//
// AT THE POOL'S OWN LIMIT. `limit` is the pool's own: the sqrt price its swap takes, as the pool
// keeps it (a Q64.64 root on the concentrated-liquidity venues, a root times 10^24 on Invariant),
// Phoenix's order price in its market's ticks, OpenBook's in its market's lots (`priceLots`, with
// `orders` the most resting orders it may match). No fee is read for it and no root taken, so a
// pool's fee, whatever it is, stays inside it: an adaptive-fee whirlpool and a Byreal pool with fees
// of its own trade here, and a limit a caller computed to keep a walk inside the tick arrays it
// supplies stays there however the fee moves. 0 is no limit: the program's own bound on Raydium's
// code, Orca and DefiTuna, an order at any price on Phoenix and OpenBook, and on Invariant none only
// selling token X; Cropper's and Crema's programs take no 0, and are given their own bound. `minOut`
// rides in the venue's own least-out field where its instruction has one (`other_amount_threshold`
// on Raydium's code and the whirlpools', Crema's `amount_limit`, Manifest's `out_atoms`), so the venue
// refuses a swap below it itself; the others' recipient balance is held to it. The instruction is the
// one a caller would build by hand for the same amount, limit and floor, byte for byte.
//
// ITS INSTRUCTION ALONE. `…Cpi` takes the accounts in the venue's own order (each function lists
// them; `@eco-incorp/sauce/svm`'s `routerSvmAccountOrder` names them, and `routerSvmAccounts`
// builds the list), the paying account beside them, what the instruction carries and its direction
// where the accounts do not say it (`aToB`, `xToY`, `paysBase`). It checks the program and nothing
// else, reads the paying account before and after and nothing else, and returns what it paid,
// reverting ("debit") if a venue took more than `amountIn`. `minOut` rides in the venue's floor; a
// venue whose instruction carries none takes no `minOut` here. An amount of 0 is the venue's to
// refuse: skip the call. `…Data` is that instruction's data alone, for a caller that sends it with
// `svm.call` itself: it checks nothing but the fields (a floor or a limit its field cannot carry
// reverts), and the caller names the program and reads the balances it wants. They are the forms for
// a caller that keeps the venue's account list itself, as a router compiling one program per trade
// does: reading an account out of an array is among the dearest steps here, and they read none. Of
// the two, `…Data` is the cheaper by a few thousand compute units: an account list passed to a
// function is built as an array first, where one written into `svm.call` is not.
//
// WHICH VENUE. A pool is an account of its venue's program, so `pool.owner` says how to read and swap
// it. The per-venue functions take one venue's pools and refuse any other. Each requires the slot's
// program to be the venue's and the pool's owner before it reads a byte of the pool, and `…Cpi` the
// program it is given to be the venue's: the authority signs the swap, so the program it calls must be
// the venue's own. Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble CLMM run one program code and
// share one pool layout and one swap; Cropper runs Orca's, with only its first swap, which Orca also
// takes at its own limit for a pool of two SPL Token mints (`swap_v2`, which names each mint and its
// token program, for the rest, and at a price for every pool).
//
// SKIPS. A failed call into another program aborts the whole Solana transaction and cannot be
// caught, so a Solana swap here checks before anything moves: it returns 0 having moved nothing for
// a missing slot (the System program as its pool), no input, a pool whose swaps are switched off, a
// paused pool or a market not open for taking, a pool with no liquidity at its price, a pool already
// at or past its limit, an input too small to buy one unit at the pool's price after its fee (the
// most it could buy, as the price only worsens: dust an earlier pool left, which a venue would take
// for nothing or refuse; at its own limit, judged at the pool's base fee), an input smaller than one
// of a market's lots, and, at a price, a fee that is more than one rate and a market limit too large
// for an order's 64-bit price. A swap that ran returns at least 1: it is held to the floor afterwards
// — `minOut`, and at least 1 — and reverts below it, so `0` always means skipped. A swap that ran and
// moved nothing either way is a skip too: a Phoenix or OpenBook order whose book has no offer within
// its price fills nothing, which only the paying account's balance tells. A failure the checks do not
// foresee still aborts the transaction: a tick array missing from the slot, and an Invariant input
// past its limit. A slot that is not the pair, whose program is not the venue's or not the pool's
// owner ("not a <venue> pool"), and a limit or a floor its order cannot carry, revert: those are the
// caller's, not the pool's state. Only a missing slot, the System program itself as its pool, is
// skipped.
//
// Every venue's swap is its own instruction, called with `svm.call`. Its data is a few fixed bytes
// around little-endian integers, packed into one word and written with one `toBytesLe`, each field
// its low bytes (an amount 8; a floor past its 8 bytes or a limit past its 16 reverts). The
// price-limited forms read the pair's balances with `@sauce/token`'s checks; the others read the
// amount alone, which only a token account of the pair that a swap moved could hold.
//
// SIZE. A Solana program rides in transactions, so the arm shares code through functions (each
// venue's data, its accounts from a slot, its checks, `clmmOrder`, `settled`) where the EVM arm keeps
// each function flat, and only the functions a program calls are compiled into it: a program calling
// one venue's function is about 0.9 to 1.7 KB, its instruction alone about 0.4 to 0.5 KB, its data
// alone about 0.2 to 0.4 KB. Each venue's functions check its own program id, so a call never signs
// into a program the caller names.
//
// No module-level `const` here: a compile-time define replaces a same-named `const` in every module,
// this one included.
import { balanceOf } from "@sauce/token";

// ---------------------------------------------------------------------------------------------
// The concentrated-liquidity limit
// ---------------------------------------------------------------------------------------------

// A concentrated-liquidity pool's order for `priceLimit`: the 32 bytes each venue's swap carries for an
// exact input of `amountIn` with no least out, up to the pool's own limit, a Q64.64 sqrt price — or
// none when the pool has nothing to sell within it (no liquidity at its price, or its price already
// at or past the limit) or the input is dust. It reads the pool where its venue keeps them: its two
// mints at `mintAAt` and `mintBAt`, its liquidity's 16 bytes at `liquidityAt` and its sqrt price's
// right after, and its fee, in millionths and taken from the input, in `feeBytes` at `feeAt` of
// `feeAccount`. Requires the two mints, in key order, to be the pair `trader` pays and buys. `stop`
// is the window's last safe tick (biased), its tick at `tickOffset`: the limit is held a tick inside.
function clmmOrder(
  pool: Account,
  mintAAt: Uint256,
  mintBAt: Uint256,
  liquidityAt: Uint256,
  feeAccount: Account,
  feeAt: Uint256,
  feeBytes: Uint256,
  trader: Account[],
  priceLimit: Uint256,
  amountIn: Uint256,
  tickOffset: Uint256,
  stop: Uint256,
): bytes {
  const pay = trader[2].address;
  const buy = trader[3].address;
  const mintA = svm.sload(pool, mintAAt, 32).toBe();
  const mintB = svm.sload(pool, mintBAt, 32).toBe();
  const liquidity = svm.sload(pool, liquidityAt, 16).toLe();
  const price = svm.sload(pool, liquidityAt + 16, 16).toLe();
  const fee = svm.sload(feeAccount, feeAt, feeBytes).toLe();
  const paysA = pay < buy;
  require(mintA == (paysA ? pay : buy) && mintB == (paysA ? buy : pay), "pool is not the pair");
  // priceLimit as a sqrt price: the higher-key token per lower-key token, times 2^64. Paying the
  // lower-key token it is upside down. Only the root the direction needs is taken.
  const limit = paysA
    ? Math.sqrt(Math.mulDiv(1 << 128, 10 ** 18, priceLimit))
    : Math.sqrt(Math.mulDiv(priceLimit, 1 << 128, 10 ** 18));
  // Moved by √(1 − fee), so that the pool's last unit, fee paid, costs exactly priceLimit. Paying the
  // lower-key token pushes the price down, the other up. The root is rounded down, so the limit sits
  // a hair inside the exact one: the pool stops a little sooner, never later.
  const root = Math.sqrt((1000000 - fee) * 10 ** 30); // √(1 − fee), times 1e18
  let own = paysA ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);
  // No further than the window: a tick inside its last safe tick, measured from the price's own tick
  // (the price lies within a tick above it). Paying the lower-key token the price falls, so the
  // bound is a floor; none, the price itself, where the window leaves no room.
  const tick = tickAt(pool, tickOffset);
  let bound = price;
  if (paysA ? stop + 1 < tick : stop > tick + 2) {
    const n = paysA ? tick - stop - 1 : stop - tick - 2;
    bound = ticksAway(price, n, !paysA);
    // A limit past it is held to a closer bound, worked out only then.
    if (paysA ? own < bound : own > bound) {
      bound = closer(price, n, !paysA);
    }
  }
  if (paysA ? own < bound : own > bound) {
    own = bound;
  }
  const better = paysA ? price > own : price < own;
  if (liquidity == 0 || !better || dust(paysA, price, fee, amountIn)) {
    return hex``;
  }
  // The amount, a floor of 0 and the limit, unchecked: the limit is under 2^128, its field's 16
  // bytes, by construction. Paying the lower-key token, it is a root of at most 2^128 · 10^18, under
  // 2^94, moved by under 10^3; paying the other, the root of a 256-bit number moved down.
  const word = (amountIn & 0xffffffffffffffff) | (own << 128);
  return word.toBytesLe(32);
}

// Whether a concentrated-liquidity pool can take `amountIn` toward a limit given in its own terms
// (0: none, the program's own bound): the limit must fit its 16-byte field and the pool's two mints,
// in key order, must be `pay` and `buy`; it can when it has liquidity at its price, its price is not
// already at or past the limit, and the input is not dust at the pool's base fee.
function clmmCan(
  mintA: Uint256,
  mintB: Uint256,
  liquidity: Uint256,
  price: Uint256,
  fee: Uint256,
  pay: Uint256,
  buy: Uint256,
  limit: Uint256,
  amountIn: Uint256,
): bool {
  // Checked here as well as in the data, so a limit no order can carry reverts whichever way the
  // price would move, not only when the swap runs.
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const paysA = pay < buy;
  require(mintA == (paysA ? pay : buy) && mintB == (paysA ? buy : pay), "pool is not the pair");
  if (liquidity == 0 || dust(paysA, price, fee, amountIn)) {
    return false;
  }
  return limit == 0 || (paysA ? price > limit : price < limit);
}

// Whether `amountIn` buys less than one unit at a Q64.64 sqrt `price` after a fee of `fee`
// millionths, which the pool takes from the input, rounded up. The price only worsens as the pool
// sells, so that is the most the input could buy: dust an earlier pool left buys nothing at all.
function dust(paysA: bool, price: Uint256, fee: Uint256, amountIn: Uint256): bool {
  const kept = (amountIn * (1000000 - fee)) / 1000000;
  const square = price * price; // a Q64.64 price is under 2^96, so its square fits
  return paysA ? kept * square < 1 << 128 : kept << 128 < square;
}

// ---------------------------------------------------------------------------------------------
// The window a swap at a price walks
// ---------------------------------------------------------------------------------------------
//
// A concentrated-liquidity swap walks the tick arrays it is given and no further, and past them it
// fails the whole transaction, every pool's trade with it. Raydium's code looks the next array its
// bitmap marks up as soon as it has crossed the last initialized tick of the one it is in, before it
// reads the limit (`NotEnoughTickArrayAccount` when its accounts hold no more, or
// `MissingTickArrayBitmapExtensionAccount` when the lookup runs past the pool's own bitmap); a
// whirlpool's swap stops at the far boundary of the third array of its window and fails on the step
// after (`TickArraySequenceInvalidIndex`); Crema's past the last initialized tick of the arrays it
// holds (`NextTickNotFound`). So each swap at a price stops at its window's last safe tick: these
// return it, and `clmmOrder` holds the limit a tick inside it.
//
// For Raydium's code and Crema that is where the furthest array the slot gives that way begins,
// since the swap reaches it by lookup and stops there; and when that array holds the price, the last
// tick initialized in it that way. The swap's `stop`, read only where it is set (not 0), moves it
// (`raydiumEdge`, `cremaEdge`): nearer, as it is; further, into that furthest array, to an
// initialized tick of it past where it begins, one read where finding its last would scan the array. A tick is an i32 read with its sign bit flipped (biased), so that
// ticks compare in order; 0 is no room at all.

// The biased tick at `at` of `account`, an i32.
function tickAt(account: Account, at: Uint256): Uint256 {
  return svm.sload(account, at, 4).toLe() ^ 0x80000000;
}

// A Raydium-code pool's last safe tick paying the lower-key token (`down`) or the other. Its slot's
// tick arrays (the bitmap extension and the arrays behind the price passed over) hold 60 ticks each:
// a fixed array 168 bytes each at 44, a Byreal dynamic one the ticks it allocated at 216, each tick's
// place among them, 1-based, in the 60 bytes at 48. A tick is initialized with liquidity: one holding
// limit orders alone is taken as not, which stops the window sooner, never later.
function raydiumStop(slot: Account[], down: bool): Uint256 {
  const pool = slot[1];
  const tick = tickAt(pool, 269);
  const spacing = svm.sload(pool, 235, 2).toLe();
  const span = 60 * spacing;
  let far = 0;
  let start = 0;
  let dynamic = false;
  for (let i = 6; i < 9; i = i + 1) {
    const kind = svm.sload(slot[i], 0, 8).toBe();
    if (kind == 0xc09b55cd31f9812a || kind == 0x6a8b98247599b838) {
      const s = tickAt(slot[i], 40);
      if ((down ? s <= tick : s + span > tick) && (far == 0 || (down ? s < start : s > start))) {
        far = i;
        start = s;
        dynamic = kind == 0x6a8b98247599b838;
      }
    }
  }
  if (far == 0) {
    return 0;
  }
  if (down ? start + span <= tick : start > tick) {
    return down ? start + span : start;
  }
  // The array holding the price: its last initialized tick that way, from its far end.
  const array = slot[far];
  const here = (tick - start) / spacing;
  for (let n = 0; n < 60; n = n + 1) {
    const offset = down ? n : 59 - n;
    if (down ? offset > here : offset <= here) {
      return 0;
    }
    let at = 64 + offset * 168;
    if (dynamic) {
      const place = svm.sload(array, 48 + offset, 1).toLe();
      at = place == 0 ? 0 : 216 + (place - 1) * 168 + 20;
    }
    if (at != 0 && svm.sload(array, at, 16).toLe() != 0) {
      return start + offset * spacing;
    }
  }
  return 0;
}

// A whirlpool's last safe tick (Orca's and Cropper's layout, its tick at 81 and spacing at 41;
// DefiTuna's at 183 and 139): the far boundary of the third of the arrays of 88 ticks its program
// lays out from the one holding its price, which its slot gives it.
function whirlpoolStop(
  pool: Account,
  tickOffset: Uint256,
  spacingOffset: Uint256,
  down: bool,
): Uint256 {
  const tick = tickAt(pool, tickOffset);
  const spacing = svm.sload(pool, spacingOffset, 2).toLe();
  const span = 88 * spacing;
  // The array holding the tick, rounded toward negative infinity: shifted by a multiple of the span
  // past 2^31 so that the division is of a positive number.
  const shift = ((0x80000000 + span - 1) / span) * span;
  const base = ((tick + shift - 0x80000000) / span) * span + 0x80000000 - shift;
  if (down) {
    return base - 2 * span;
  }
  // Paying the higher-key token the window starts an array later where the tick is in the last
  // spacing of its own.
  const first = tick + spacing >= base + span ? base + span : base;
  return first + 2 * span + 87 * spacing;
}

// Crema's last safe tick: its slot's leading tick arrays are those its map marks, in walk order, of
// 64 ticks of 133 bytes at 44 each, initialized when its first byte is 1; an array's index at 8
// counts arrays of 64 × spacing from the pool's least tick, −443636 rounded to the spacing.
function cremaStop(slot: Account[], down: bool): Uint256 {
  const pool = slot[1];
  const tick = tickAt(pool, 206);
  const spacing = svm.sload(pool, 168, 2).toLe();
  const span = 64 * spacing;
  const last = slot[7].address == 0 ? slot[6] : slot[8].address == 0 ? slot[7] : slot[8];
  const start = 0x80000000 - 443636 + (443636 % spacing) + svm.sload(last, 8, 2).toLe() * span;
  if (down ? start + span <= tick : start > tick) {
    return down ? start + span : start;
  }
  const here = (tick - start) / spacing;
  for (let n = 0; n < 64; n = n + 1) {
    const offset = down ? n : 63 - n;
    if (down ? offset > here : offset <= here) {
      return 0;
    }
    if (svm.sload(last, 44 + offset * 133, 1).toLe() == 1) {
      return start + offset * spacing;
    }
  }
  return 0;
}

// The swap's `stop`, set (not 0), moving a Raydium-code window's last safe tick, `window` (0 for no
// room): 0 to skip the pool (1); the stop's tick (its low 32 bits) where it is nearer; further, only
// an initialized tick of the tick array the cook's builder read it in, the slot's place (6 to 8) in
// the bits from 40, which past the window can only be the furthest array: one read checks it.
function raydiumEdge(slot: Account[], down: bool, window: Uint256, stop: Uint256): Uint256 {
  const tick = stop & 0xffffffff;
  if (stop == 1 || window == 0) {
    return 0;
  }
  if (down ? tick > window : tick < window) {
    return tick;
  }
  const at = stop >> 40;
  if (at < 6 || at > 8) {
    return window;
  }
  const array = slot[at];
  const kind = svm.sload(array, 0, 8).toBe();
  if (kind != 0xc09b55cd31f9812a && kind != 0x6a8b98247599b838) {
    return window;
  }
  const spacing = svm.sload(slot[1], 235, 2).toLe();
  const start = tickAt(array, 40);
  if (tick < start || tick >= start + 60 * spacing || (tick - start) % spacing != 0) {
    return window;
  }
  const offset = (tick - start) / spacing;
  let gross = 64 + offset * 168;
  if (kind == 0x6a8b98247599b838) {
    const place = svm.sload(array, 48 + offset, 1).toLe();
    gross = place == 0 ? 0 : 216 + (place - 1) * 168 + 20;
  }
  return gross != 0 && svm.sload(array, gross, 16).toLe() != 0 ? tick : window;
}

// Crema's (`raydiumEdge`): further, only an initialized tick of the last tick array its slot gives.
function cremaEdge(slot: Account[], down: bool, window: Uint256, stop: Uint256): Uint256 {
  if (stop == 1 || window == 0) {
    return 0;
  }
  if (down ? stop > window : stop < window) {
    return stop;
  }
  const spacing = svm.sload(slot[1], 168, 2).toLe();
  const span = 64 * spacing;
  const last = slot[7].address == 0 ? slot[6] : slot[8].address == 0 ? slot[7] : slot[8];
  const start = 0x80000000 - 443636 + (443636 % spacing) + svm.sload(last, 8, 2).toLe() * span;
  const initialized =
    stop >= start &&
    stop < start + span &&
    (stop - start) % spacing == 0 &&
    svm.sload(last, 44 + ((stop - start) / spacing) * 133, 1).toLe() == 1;
  return initialized ? stop : window;
}

// √1.0001^n times 1e18, bounded below by its first four binomial terms in x = √1.0001 − 1 (rounded
// down, times 1e18), all positive: exact to n = 3, and short by 2·10^-3 at 10,800 ticks, 10^-1 at
// 36,000.
function binomial(n: Uint256): Uint256 {
  const x = 49998750062496;
  const one = 10 ** 18;
  const a = n * x;
  const b = n > 1 ? (n - 1) * x : 0;
  const c = n > 2 ? (n - 2) * x : 0;
  return one + a + Math.mulDiv(a, b, 2 * one) + Math.mulDiv(Math.mulDiv(a, b, one), c, 6 * one);
}

// The Q64.64 sqrt price `n` ticks from `price`, up or down, by `binomial`'s power: inside the exact
// one, under it going up, over it going down.
function ticksAway(price: Uint256, n: Uint256, up: bool): Uint256 {
  const one = 10 ** 18;
  const power = binomial(n);
  return up ? Math.mulDiv(price, power, one) : Math.mulDiv(price, one, power);
}

// `ticksAway` with a closer power: the bound of a sixteenth of `n` squared four times, times the
// rest's, each rounded down: still never above the exact power, and short of it by 10^-6 at 10,800
// ticks, 10^-4 at 36,000.
function closer(price: Uint256, n: Uint256, up: bool): Uint256 {
  const one = 10 ** 18;
  let power = binomial(n >> 4);
  power = Math.mulDiv(power, power, one);
  power = Math.mulDiv(power, power, one);
  power = Math.mulDiv(power, power, one);
  power = Math.mulDiv(power, power, one);
  power = Math.mulDiv(power, binomial(n & 15), one);
  return up ? Math.mulDiv(price, power, one) : Math.mulDiv(price, one, power);
}

// ---------------------------------------------------------------------------------------------
// Each venue's instruction data
// ---------------------------------------------------------------------------------------------
//
// `<venue>Data` is a swap's instruction data alone, the encoding `<venue>AtLimit` sends: a caller
// that keeps the venue's accounts and program itself (`@eco-incorp/sauce/svm`'s
// `routerSvmAccountOrder` names them in order) calls `svm.call(program, [accounts…], <venue>Data(…))`,
// the cheapest way to send it on chain. A program that knows every field but the amount when it is
// generated can have `@eco-incorp/sauce/svm`'s `routerSvmDataTemplate` write the same bytes around
// the amount in TypeScript, where its checks run once and cost nothing on chain: the compiler does
// not fold a check here away for a literal argument. The data is a few fixed bytes around
// little-endian integers, packed into one word and written with one `toBytesLe`, the dearest step of
// building it, so each field takes the low bytes `toBytesLe` would write for it alone: an amount its
// low 8. A `minOut` past 64 bits and a limit past 128, which their fields cannot carry, revert: cut
// to its field, a limit of 2^128 would be 0, which most of these venues read as no limit at all.

// Raydium CLMM's `swap_v2`: exact input of `amountIn`, `minOut` its least out, `limit` its
// `sqrt_price_limit_x64`. The direction is the accounts'.
export function raydiumClmmData(amountIn: Uint256, limit: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), hex`01`);
}

// PancakeSwap CLMM's, Byreal's and Stabble CLMM's: Raydium's code, Raydium's data.
export function pancakeswapClmmData(amountIn: Uint256, limit: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), hex`01`);
}

export function byrealData(amountIn: Uint256, limit: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), hex`01`);
}

export function stabbleClmmData(amountIn: Uint256, limit: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), hex`01`);
}

// A whirlpool's classic `swap`, exact input, A to B when `aToB`: for a pool of two SPL Token mints.
export function orcaWhirlpoolData(
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  aToB: bool,
): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(32), aToB ? hex`0101` : hex`0100`);
}

// A whirlpool's `swap_v2`, which also says it passes no remaining-accounts info: for any pool, and
// the only swap for one with a Token-2022 mint.
export function orcaWhirlpoolV2Data(
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  aToB: bool,
): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), aToB ? hex`010100` : hex`010000`);
}

// Cropper's `swap`, a whirlpool's classic one.
export function cropperData(amountIn: Uint256, limit: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(32), aToB ? hex`0101` : hex`0100`);
}

// DefiTuna's `swap`: a whirlpool's `swap_v2` fields under `swap`'s name.
export function defitunaData(
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  aToB: bool,
): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(32), aToB ? hex`010100` : hex`010000`);
}

// Crema's `swap`: the direction and exact input first, then the amount, its `amount_limit` (the least
// out) and its `sqrt_price_limit`.
export function cremaData(amountIn: Uint256, limit: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = aToB ? hex`f8c69e91e17587c80101` : hex`f8c69e91e17587c80001`;
  return swap.concat(word.toBytesLe(32));
}

// Invariant's `swap`: the direction (selling X when `xToY`), the amount, exact input and its
// `sqrt_price_limit`. It carries no least out.
export function invariantData(amountIn: Uint256, limit: Uint256, xToY: bool): bytes {
  const swap = xToY ? hex`f8c69e91e17587c801` : hex`f8c69e91e17587c800`;
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (1 << 64) | (limit << 72);
  return swap.concat(word.toBytesLe(25));
}

// Manifest's `Swap`: exact input of `amountIn`, `minOut` as its least out (`out_atoms`), selling base
// when `paysBase`.
export function manifestData(amountIn: Uint256, minOut: Uint256, paysBase: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // One word: the tag (4) and the flags (`is_base_in`, `is_exact_in`) a literal each way, the amount
  // and the floor between them.
  const word =
    (paysBase ? 0x1010000000000000000000000000000000004 : 0x1000000000000000000000000000000000004) |
    ((amountIn & 0xffffffffffffffff) << 8) |
    (minOut << 72);
  return word.toBytesLe(19);
}

// Phoenix's `Swap`: an immediate-or-cancel order for every lot of `amountIn`, in `lot`, the market's
// lot size of the token paid (base lots selling base, quote lots buying it), at `ticks` (0: none, the
// book at any price). No minimum fill, a self-trade cancels the resting order, no match limit, client
// id 0, no deposited funds, no expiry. It carries no least out. An input under one lot is no order:
// skip it.
export function phoenixData(
  amountIn: Uint256,
  lot: Uint256,
  ticks: Uint256,
  paysBase: bool,
): bytes {
  require(ticks <= 0xffffffffffffffff, "limit past 64 bits");
  const lots = (amountIn / lot) & 0xffffffffffffffff;
  const side = paysBase ? hex`000201` : hex`000200`;
  const rest = hex`00000000000000000000000000000000010000000000000000000000000000000000000000`;
  const base = paysBase ? lots : 0;
  const quote = paysBase ? 0 : lots;
  if (ticks == 0) {
    const any = (base << 8) | (quote << 72);
    return side.concat(any.toBytesLe(17), rest);
  }
  const priced = 1 | (ticks << 8) | (base << 72) | (quote << 136);
  return side.concat(priced.toBytesLe(25), rest);
}

// OpenBook v2's `place_take_order`: every lot of `amountIn` of the token paid, by the market's lot
// sizes `baseLot` and `quoteLot` (base lots selling base, quote lots including the fee buying it; the
// other side unbounded); `priceLots`, `orders` and `paysBase` as `openbookV2LotsData` takes them.
export function openbookV2Data(
  amountIn: Uint256,
  baseLot: Uint256,
  quoteLot: Uint256,
  priceLots: Uint256,
  orders: Uint256,
  paysBase: bool,
): bytes {
  const most = 0x7fffffffffffffff;
  const baseLots = paysBase ? amountIn / baseLot : most / baseLot;
  const quoteLots = paysBase ? most / quoteLot : amountIn / quoteLot;
  return openbookV2LotsData(baseLots, quoteLots, priceLots, orders, paysBase);
}

// OpenBook v2's `place_take_order` in the market's own lots: at most `baseLots` base lots and
// `quoteLots` quote lots including the fee (the side paid bounds the order; give the other its
// most), an immediate-or-cancel order at `priceLots` (0: a market order, at any price, whose price
// the program does not read and requires positive), matching at most `orders` resting orders, selling
// base when `paysBase`. It carries no least out. For a caller that knows the market's lot sizes when
// it compiles: it divides nothing.
export function openbookV2LotsData(
  baseLots: Uint256,
  quoteLots: Uint256,
  priceLots: Uint256,
  orders: Uint256,
  paysBase: bool,
): bytes {
  require((priceLots | baseLots | quoteLots) <= 0x7fffffffffffffff &&
    orders <= 255, "limit past its field");
  // A market order's price is 1 and its type 3; an order at a price is immediate-or-cancel, type 1.
  const order =
    priceLots == 0
      ? 0x300000000000000000000000000000000000000000000000100
      : (priceLots << 8) | 0x100000000000000000000000000000000000000000000000000;
  const take = hex`032c47031ac7cb55`;
  const word =
    order |
    (paysBase ? (orders << 208) | 1 : orders << 208) |
    (baseLots << 72) |
    (quoteLots << 136);
  return take.concat(word.toBytesLe(27));
}

// ---------------------------------------------------------------------------------------------
// Each venue's swap from a slot: its accounts, in the venue's order, from the slot and the trader,
// and its data. The caller has checked the slot's program is the venue's.
// ---------------------------------------------------------------------------------------------

// Raydium CLMM's layout, on its code's four programs. The slot's `config` is the pool's `AmmConfig`,
// `extra` its observation account; a tenth account that is not the System program is the pool's
// tick-array bitmap extension, which goes first among the remaining accounts, before the tick arrays.
function cpiRaydium(
  slot: Account[],
  trader: Account[],
  paysA: bool,
  amountIn: Uint256,
  limit: Uint256,
  floor: Uint256,
  recipient: Account,
): void {
  const data = raydiumClmmData(amountIn, limit, floor);
  // The input and output vault, token program, Token-2022 and the memo program, both mints, then the
  // bitmap extension, where there is one, and the tick arrays. Seventeen accounts are more values
  // than a function holds at once, so that list is filled in place.
  if (slot.length > 9 && slot[9].address != 0) {
    const p = slot[0];
    const accounts = [p, p, p, p, p, p, p, p, p, p, p, p, p, p, p, p, p];
    accounts[0] = trader[0];
    accounts[1] = slot[2];
    accounts[2] = slot[1];
    accounts[3] = trader[1];
    accounts[4] = recipient;
    accounts[5] = paysA ? slot[3] : slot[4];
    accounts[6] = paysA ? slot[4] : slot[3];
    accounts[7] = slot[5];
    accounts[8] = trader[4];
    accounts[9] = trader[5];
    accounts[10] = trader[6];
    accounts[11] = trader[2];
    accounts[12] = trader[3];
    accounts[13] = slot[9];
    accounts[14] = slot[6];
    accounts[15] = slot[7];
    accounts[16] = slot[8];
    svm.call(slot[0], accounts, data);
    return;
  }
  svm.call(
    slot[0],
    [
      trader[0],
      slot[2],
      slot[1],
      trader[1],
      recipient,
      paysA ? slot[3] : slot[4],
      paysA ? slot[4] : slot[3],
      slot[5],
      trader[4],
      trader[5],
      trader[6],
      trader[2],
      trader[3],
      slot[6],
      slot[7],
      slot[8],
    ],
    data,
  );
}

// Orca Whirlpools' layout: the classic `swap` when both mints are SPL Token's, else `swap_v2`, which
// takes each mint and its token program. The slot's `config` is unused, `extra` the pool's oracle,
// which an adaptive-fee pool writes. Token A's accounts come first whatever the direction.
function cpiWhirlpool(
  slot: Account[],
  trader: Account[],
  paysA: bool,
  amountIn: Uint256,
  limit: Uint256,
  floor: Uint256,
  recipient: Account,
): void {
  const mintA = paysA ? trader[2] : trader[3];
  const mintB = paysA ? trader[3] : trader[2];
  const ownerA = paysA ? trader[1] : recipient;
  const ownerB = paysA ? recipient : trader[1];
  const token = trader[4];
  if (mintA.owner == token.address && mintB.owner == token.address) {
    svm.call(
      slot[0],
      [
        token,
        trader[0],
        slot[1],
        ownerA,
        slot[3],
        ownerB,
        slot[4],
        slot[6],
        slot[7],
        slot[8],
        slot[5],
      ],
      orcaWhirlpoolData(amountIn, limit, floor, paysA),
    );
    return;
  }
  svm.call(
    slot[0],
    [
      mintA.owner == token.address ? token : trader[5],
      mintB.owner == token.address ? token : trader[5],
      trader[6],
      trader[0],
      slot[1],
      mintA,
      mintB,
      ownerA,
      slot[3],
      ownerB,
      slot[4],
      slot[6],
      slot[7],
      slot[8],
      slot[5],
    ],
    orcaWhirlpoolV2Data(amountIn, limit, floor, paysA),
  );
}

// Cropper, on Orca's code with only its first `swap`, and no Token-2022: the whirlpool's layout,
// its accounts without the mints and the memo program. Its swap loads every tick array it is passed,
// so each must exist.
function cpiCropper(
  slot: Account[],
  trader: Account[],
  paysA: bool,
  amountIn: Uint256,
  limit: Uint256,
  floor: Uint256,
  recipient: Account,
): void {
  const source = trader[1];
  svm.call(
    slot[0],
    [
      trader[4],
      trader[0],
      slot[1],
      paysA ? source : recipient,
      slot[3],
      paysA ? recipient : source,
      slot[4],
      slot[6],
      slot[7],
      slot[8],
      slot[5],
    ],
    cropperData(amountIn, limit, floor, paysA),
  );
}

// DefiTuna's layout. The slot's `config` and `extra` are unused. Its pools hold resting limit orders
// too, which a swap fills at their tick's price: within the limit, like the rest.
function cpiDefituna(
  slot: Account[],
  trader: Account[],
  paysA: bool,
  amountIn: Uint256,
  limit: Uint256,
  floor: Uint256,
  recipient: Account,
): void {
  const source = trader[1];
  const mintA = paysA ? trader[2] : trader[3];
  const mintB = paysA ? trader[3] : trader[2];
  svm.call(
    slot[0],
    [
      mintA.owner == trader[5].address ? trader[5] : trader[4],
      mintB.owner == trader[5].address ? trader[5] : trader[4],
      trader[6],
      trader[0],
      slot[1],
      mintA,
      mintB,
      paysA ? source : recipient,
      paysA ? recipient : source,
      slot[3],
      slot[4],
      slot[6],
      slot[7],
      slot[8],
    ],
    defitunaData(amountIn, limit, floor, paysA),
  );
}

// Crema's layout. The slot's `config` is the pool's `clmm_config`, `extra` its tick-array map. Its
// swap refuses a tick array its map does not mark, so it is passed only the slot's leading arrays: the
// first, and each after it until a System program.
function cpiCrema(
  slot: Account[],
  trader: Account[],
  paysA: bool,
  amountIn: Uint256,
  limit: Uint256,
  floor: Uint256,
  recipient: Account,
): void {
  const source = trader[1];
  const mintA = paysA ? trader[2] : trader[3];
  const mintB = paysA ? trader[3] : trader[2];
  const ownerA = paysA ? source : recipient;
  const ownerB = paysA ? recipient : source;
  const data = cremaData(amountIn, limit, floor, paysA);
  if (slot[7].address == 0) {
    svm.call(
      slot[0],
      [
        slot[2],
        slot[1],
        mintA,
        mintB,
        ownerA,
        ownerB,
        slot[3],
        slot[4],
        slot[5],
        trader[0],
        trader[4],
        slot[6],
      ],
      data,
    );
    return;
  }
  if (slot[8].address == 0) {
    svm.call(
      slot[0],
      [
        slot[2],
        slot[1],
        mintA,
        mintB,
        ownerA,
        ownerB,
        slot[3],
        slot[4],
        slot[5],
        trader[0],
        trader[4],
        slot[6],
        slot[7],
      ],
      data,
    );
    return;
  }
  svm.call(
    slot[0],
    [
      slot[2],
      slot[1],
      mintA,
      mintB,
      ownerA,
      ownerB,
      slot[3],
      slot[4],
      slot[5],
      trader[0],
      trader[4],
      slot[6],
      slot[7],
      slot[8],
    ],
    data,
  );
}

// Phoenix's layout: the slot's `config` is the log authority, `vaultA`/`vaultB` the market's base and
// quote vaults. Base and quote are not in key order, so which one is paid is the caller's to say.
function cpiPhoenix(
  slot: Account[],
  trader: Account[],
  paysBase: bool,
  amountIn: Uint256,
  lot: Uint256,
  ticks: Uint256,
  recipient: Account,
): void {
  const source = trader[1];
  svm.call(
    slot[0],
    [
      slot[0],
      slot[2],
      slot[1],
      trader[0],
      paysBase ? source : recipient,
      paysBase ? recipient : source,
      slot[3],
      slot[4],
      trader[4],
    ],
    phoenixData(amountIn, lot, ticks, paysBase),
  );
}

// Invariant's layout: `config` the program's state, `vaultA`/`vaultB` the pool's X and Y reserves,
// `extra` its tickmap, then the ticks the swap may cross (one account each: the first, and each after
// it until a System program) and, tenth, the program's authority. Token X is the pool's first mint.
function cpiInvariant(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  paysX: bool,
  recipient: Account,
): void {
  const source = trader[1];
  const ownerX = paysX ? source : recipient;
  const ownerY = paysX ? recipient : source;
  const data = invariantData(amountIn, limit, paysX);
  if (slot[7].address == 0) {
    svm.call(
      slot[0],
      [
        slot[2],
        slot[1],
        slot[5],
        ownerX,
        ownerY,
        slot[3],
        slot[4],
        trader[0],
        slot[9],
        trader[4],
        slot[6],
      ],
      data,
    );
    return;
  }
  if (slot[8].address == 0) {
    svm.call(
      slot[0],
      [
        slot[2],
        slot[1],
        slot[5],
        ownerX,
        ownerY,
        slot[3],
        slot[4],
        trader[0],
        slot[9],
        trader[4],
        slot[6],
        slot[7],
      ],
      data,
    );
    return;
  }
  svm.call(
    slot[0],
    [
      slot[2],
      slot[1],
      slot[5],
      ownerX,
      ownerY,
      slot[3],
      slot[4],
      trader[0],
      slot[9],
      trader[4],
      slot[6],
      slot[7],
      slot[8],
    ],
    data,
  );
}

// Manifest's layout: the slot's `config` is the System program, `vaultA`/`vaultB` the market's base
// and quote vaults. The authority pays and signs; each side's mint and token program follow.
function cpiManifest(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  floor: Uint256,
  paysBase: bool,
  recipient: Account,
): void {
  const source = trader[1];
  const base = paysBase ? trader[2] : trader[3];
  const quote = paysBase ? trader[3] : trader[2];
  svm.call(
    slot[0],
    [
      trader[0],
      slot[1],
      slot[2],
      paysBase ? source : recipient,
      paysBase ? recipient : source,
      slot[3],
      slot[4],
      base.owner == trader[5].address ? trader[5] : trader[4],
      base,
      quote.owner == trader[5].address ? trader[5] : trader[4],
      quote,
    ],
    manifestData(amountIn, floor, paysBase),
  );
}

// OpenBook v2's layout: `config` the market's authority, `vaultA`/`vaultB` its base and quote vaults,
// `extra` its event heap, then its bids and asks, the System program, and its two oracles (the
// program itself for one it has not). The authority signs and pays any penalty.
function cpiOpenbookV2(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLots: Uint256,
  orders: Uint256,
  paysBase: bool,
  recipient: Account,
): void {
  const market = slot[1];
  const source = trader[1];
  const data = openbookV2Data(
    amountIn,
    svm.sload(market, 456, 8).toLe(),
    svm.sload(market, 448, 8).toLe(),
    priceLots,
    orders,
    paysBase,
  );
  svm.call(
    slot[0],
    [
      trader[0],
      trader[0],
      market,
      slot[2],
      slot[6],
      slot[7],
      slot[3],
      slot[4],
      slot[5],
      paysBase ? source : recipient,
      paysBase ? recipient : source,
      slot[9],
      slot[10],
      trader[4],
      slot[8],
      slot[0],
    ],
    data,
  );
}

// ---------------------------------------------------------------------------------------------
// Each venue's swap at a price: the pool's checks and its own limit for `priceLimit`, then its swap
// with no least out. The caller has required the slot's program to be the venue's and the pool's
// owner, and measures what moved.
//
// Each writes its instruction itself, from `clmmOrder`'s bytes (Phoenix's from its ticks), and checks
// none of its fields: its floor is 0 and its limit fits, so no check of `…Data`'s could fail here,
// and every program swapping at a price would carry them. Its accounts are a slot's nine: Raydium's code
// with no bitmap extension, and Orca's `swap_v2` for every pool. Each sends the bytes its `…Data`
// writes for the same amount and limit and a floor of 0.
// ---------------------------------------------------------------------------------------------

// Raydium CLMM's layout, on its code's four programs. The pool's fee is its `AmmConfig`'s rate. The
// input and output vault, token program, Token-2022 and the memo program, both mints, then the tick
// arrays.
function swapRaydium(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  recipient: Account,
  given: Uint256,
): void {
  const pool = slot[1];
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
  const paysA = trader[2].address < trader[3].address;
  // The swap's stop, read only where it is set.
  let stop = raydiumStop(slot, paysA);
  if (given != 0) {
    stop = raydiumEdge(slot, paysA, stop, given);
  }
  if (stop == 0) {
    return;
  }
  const order = clmmOrder(
    pool,
    73,
    105,
    237,
    slot[2],
    47,
    4,
    trader,
    priceLimit,
    amountIn,
    269,
    stop,
  );
  if (order.length == 0) {
    return;
  }
  const swapV2 = hex`2b04ed0b1ac91e62`;
  svm.call(
    slot[0],
    [
      trader[0],
      slot[2],
      pool,
      trader[1],
      recipient,
      paysA ? slot[3] : slot[4],
      paysA ? slot[4] : slot[3],
      slot[5],
      trader[4],
      trader[5],
      trader[6],
      trader[2],
      trader[3],
      slot[6],
      slot[7],
      slot[8],
    ],
    swapV2.concat(order, hex`01`),
  );
}

// Orca Whirlpools' layout, `swap_v2`: each mint's token program, the memo program, the authority,
// the pool, both mints, then token A's account and vault, token B's, the tick arrays and the
// oracle. A pool with an adaptive fee is skipped: its fee rises with volatility, past the rate the
// pool shows.
function swapWhirlpool(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  recipient: Account,
  given: Uint256,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 41, 2).toLe() != svm.sload(pool, 43, 2).toLe()) {
    return;
  }
  const paysA = trader[2].address < trader[3].address;
  let stop = whirlpoolStop(pool, 81, 41, paysA);
  // The swap's stop, where it is set: 1 skips the pool, a tick nearer than the window holds it.
  if (given != 0) {
    if (given == 1) {
      return;
    }
    if (paysA ? given > stop : given < stop) {
      stop = given;
    }
  }
  const order = clmmOrder(pool, 101, 181, 49, pool, 45, 2, trader, priceLimit, amountIn, 81, stop);
  if (order.length == 0) {
    return;
  }
  const mintA = paysA ? trader[2] : trader[3];
  const mintB = paysA ? trader[3] : trader[2];
  const token = trader[4];
  const swapV2 = hex`2b04ed0b1ac91e62`;
  svm.call(
    slot[0],
    [
      mintA.owner == token.address ? token : trader[5],
      mintB.owner == token.address ? token : trader[5],
      trader[6],
      trader[0],
      pool,
      mintA,
      mintB,
      paysA ? trader[1] : recipient,
      slot[3],
      paysA ? recipient : trader[1],
      slot[4],
      slot[6],
      slot[7],
      slot[8],
      slot[5],
    ],
    swapV2.concat(order, paysA ? hex`010100` : hex`010000`),
  );
}

// Cropper, a whirlpool's classic `swap`; an adaptive fee is skipped, as on Orca.
function swapCropper(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  recipient: Account,
  given: Uint256,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 41, 2).toLe() != svm.sload(pool, 43, 2).toLe()) {
    return;
  }
  const paysA = trader[2].address < trader[3].address;
  let stop = whirlpoolStop(pool, 81, 41, paysA);
  // The swap's stop, where it is set: 1 skips the pool, a tick nearer than the window holds it.
  if (given != 0) {
    if (given == 1) {
      return;
    }
    if (paysA ? given > stop : given < stop) {
      stop = given;
    }
  }
  const order = clmmOrder(pool, 101, 181, 49, pool, 45, 2, trader, priceLimit, amountIn, 81, stop);
  if (order.length == 0) {
    return;
  }
  const swap = hex`f8c69e91e17587c8`;
  svm.call(
    slot[0],
    [
      trader[4],
      trader[0],
      pool,
      paysA ? trader[1] : recipient,
      slot[3],
      paysA ? recipient : trader[1],
      slot[4],
      slot[6],
      slot[7],
      slot[8],
      slot[5],
    ],
    swap.concat(order, paysA ? hex`0101` : hex`0100`),
  );
}

// DefiTuna's layout.
function swapDefituna(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  recipient: Account,
  given: Uint256,
): void {
  const pool = slot[1];
  const paysA = trader[2].address < trader[3].address;
  let stop = whirlpoolStop(pool, 183, 139, paysA);
  // The swap's stop, where it is set: 1 skips the pool, a tick nearer than the window holds it.
  if (given != 0) {
    if (given == 1) {
      return;
    }
    if (paysA ? given > stop : given < stop) {
      stop = given;
    }
  }
  const order = clmmOrder(pool, 11, 43, 151, pool, 143, 2, trader, priceLimit, amountIn, 183, stop);
  if (order.length == 0) {
    return;
  }
  const mintA = paysA ? trader[2] : trader[3];
  const mintB = paysA ? trader[3] : trader[2];
  const swap = hex`f8c69e91e17587c8`;
  svm.call(
    slot[0],
    [
      mintA.owner == trader[5].address ? trader[5] : trader[4],
      mintB.owner == trader[5].address ? trader[5] : trader[4],
      trader[6],
      trader[0],
      pool,
      mintA,
      mintB,
      paysA ? trader[1] : recipient,
      paysA ? recipient : trader[1],
      slot[3],
      slot[4],
      slot[6],
      slot[7],
      slot[8],
    ],
    swap.concat(order, paysA ? hex`010100` : hex`010000`),
  );
}

// Crema's layout, as `cpiCrema` sends it: only the slot's leading tick arrays, which its map marks.
// A paused pool is skipped.
function swapCrema(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  recipient: Account,
  given: Uint256,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 747, 1).toLe() != 0) {
    return;
  }
  const paysA = trader[2].address < trader[3].address;
  let stop = cremaStop(slot, paysA);
  if (given != 0) {
    stop = cremaEdge(slot, paysA, stop, given);
  }
  if (stop == 0) {
    return;
  }
  const order = clmmOrder(pool, 40, 72, 174, pool, 172, 2, trader, priceLimit, amountIn, 206, stop);
  if (order.length == 0) {
    return;
  }
  const swap = paysA ? hex`f8c69e91e17587c80101` : hex`f8c69e91e17587c80001`;
  const mintA = paysA ? trader[2] : trader[3];
  const mintB = paysA ? trader[3] : trader[2];
  const ownerA = paysA ? trader[1] : recipient;
  const ownerB = paysA ? recipient : trader[1];
  const data = swap.concat(order);
  if (slot[7].address == 0) {
    svm.call(
      slot[0],
      [
        slot[2],
        pool,
        mintA,
        mintB,
        ownerA,
        ownerB,
        slot[3],
        slot[4],
        slot[5],
        trader[0],
        trader[4],
        slot[6],
      ],
      data,
    );
  } else if (slot[8].address == 0) {
    svm.call(
      slot[0],
      [
        slot[2],
        pool,
        mintA,
        mintB,
        ownerA,
        ownerB,
        slot[3],
        slot[4],
        slot[5],
        trader[0],
        trader[4],
        slot[6],
        slot[7],
      ],
      data,
    );
  } else {
    svm.call(
      slot[0],
      [
        slot[2],
        pool,
        mintA,
        mintB,
        ownerA,
        ownerB,
        slot[3],
        slot[4],
        slot[5],
        trader[0],
        trader[4],
        slot[6],
        slot[7],
        slot[8],
      ],
      data,
    );
  }
}

// Phoenix: an immediate-or-cancel order at the limit price, for every lot of the input. A market not
// open for taking, an input under one lot and a limit past the order's 64-bit price are skipped.
function swapPhoenix(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 8, 8).toLe() != 1) {
    return; // not open for taking: post-only, paused or closed
  }
  const pay = trader[2].address;
  const buy = trader[3].address;
  const paysBase = svm.sload(pool, 48, 32).toBe() == pay;
  require(svm.sload(pool, paysBase ? 128 : 48, 32).toBe() == buy, "market is not the pair");
  const fee = svm.sload(pool, 856, 8).toLe();
  const baseLot = svm.sload(pool, 112, 8).toLe();
  const quoteLot = svm.sload(pool, 192, 8).toLe();
  // One tick, in priceLimit's units: quote atoms per base atom, times 10^18.
  const tick = Math.mulDiv(
    svm.sload(pool, 840, 8).toLe() * quoteLot,
    10 ** 18,
    svm.sload(pool, 832, 8).toLe() * baseLot,
  );
  // Buying base: the most a base atom may cost before the fee. Selling it: the least it must fetch
  // before the fee is taken, rounded up.
  let ticks = Math.mulDiv(priceLimit, 10000, (10000 + fee) * tick);
  if (paysBase) {
    ticks = Math.mulDiv(10 ** 36, 10000, priceLimit * (10000 - fee) * tick) + 1;
  }
  // Every lot of the input, of the token it pays: base lots selling base, quote lots buying it. The
  // order's price is 64 bits, and a limit past them would be cut to some other price: no order. A
  // limit under one tick, buying, finds no offer either.
  const lot = paysBase ? baseLot : quoteLot;
  if (amountIn < lot || ticks == 0 || ticks > 0xffffffffffffffff) {
    return;
  }
  // `phoenixData`'s order at a price, its ticks held to 64 bits above.
  const lots = (amountIn / lot) & 0xffffffffffffffff;
  const order = 1 | (ticks << 8) | (paysBase ? lots << 72 : lots << 136);
  const side = paysBase ? hex`000201` : hex`000200`;
  const rest = hex`00000000000000000000000000000000010000000000000000000000000000000000000000`;
  svm.call(
    slot[0],
    [
      slot[0],
      slot[2],
      pool,
      trader[0],
      paysBase ? trader[1] : recipient,
      paysBase ? recipient : trader[1],
      slot[3],
      slot[4],
      trader[4],
    ],
    side.concat(order.toBytesLe(25), rest),
  );
}

// What a swap moved: 0 when `source` paid nothing (`held` is its balance before), else
// what the recipient received over `before`, held to the floor — `minOut`, and at least 1. A swap
// cannot change a token account's owner or mint, so these reads take the amount alone.
function settled(
  source: Account,
  recipient: Account,
  held: Uint256,
  before: Uint256,
  minOut: Uint256,
): Uint256 {
  if (svm.sload(source, 64, 8).toLe() == held) {
    return 0;
  }
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// ---------------------------------------------------------------------------------------------
// One venue each
// ---------------------------------------------------------------------------------------------

// Raydium CLMM, CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK.
export function raydiumClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
  stop: Uint256,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xa5d5ca9e04cf5db590b714ba2fe32cb159133fc1c192b72257fd07d39cb0401e;
  require(owned && slot[0].address == pool.owner, "not a Raydium CLMM pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapRaydium(slot, trader, amountIn, priceLimit, recipient, stop);
  return settled(trader[1], recipient, held, before, minOut);
}

// PancakeSwap CLMM, HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq: Raydium's code.
export function pancakeswapClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
  stop: Uint256,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xf9ddcb1fe2f88ebbac5f5b97b4b90ad49551962b89419d765284622845e41cf8;
  require(owned && slot[0].address == pool.owner, "not a PancakeSwap CLMM pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapRaydium(slot, trader, amountIn, priceLimit, recipient, stop);
  return settled(trader[1], recipient, held, before, minOut);
}

// Byreal, REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2: Raydium's code, with fees a pool may add.
export function byreal(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
  stop: Uint256,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x0634d20f1bf56dd164e3c13c7836a4229ec5ab21ff54528390a51789f3cdbbdb;
  require(owned && slot[0].address == pool.owner, "not a Byreal pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapRaydium(slot, trader, amountIn, priceLimit, recipient, stop);
  return settled(trader[1], recipient, held, before, minOut);
}

// Stabble CLMM, 6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6: Raydium's code.
export function stabbleClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
  stop: Uint256,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x539a8f14242a332eff95ba037c2c3936689d09da4571718f89491b86302586a3;
  require(owned && slot[0].address == pool.owner, "not a Stabble CLMM pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapRaydium(slot, trader, amountIn, priceLimit, recipient, stop);
  return settled(trader[1], recipient, held, before, minOut);
}

// Orca Whirlpools, whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc.
export function orcaWhirlpool(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
  stop: Uint256,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x0e03685f8e909053e458121c66f5a76aedc7706aa11c82f8aa952a8f2b7879a9;
  require(owned && slot[0].address == pool.owner, "not an Orca whirlpool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapWhirlpool(slot, trader, amountIn, priceLimit, recipient, stop);
  return settled(trader[1], recipient, held, before, minOut);
}

// Cropper, H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt: Orca's code. It needs every tick array its
// walk reaches to exist.
export function cropper(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
  stop: Uint256,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xefa6e5dfb789ce3db66eccedff9eab02ca6a57cf068746befe835ab4c2f2ee0f;
  require(owned && slot[0].address == pool.owner, "not a Cropper pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapCropper(slot, trader, amountIn, priceLimit, recipient, stop);
  return settled(trader[1], recipient, held, before, minOut);
}

// DefiTuna, fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9.
export function defituna(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
  stop: Uint256,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x09db19e5e1ffb1eba60fcffdafaa314664a12f6cac8af15485b5ddd92b6f3ae6;
  require(owned && slot[0].address == pool.owner, "not a DefiTuna pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapDefituna(slot, trader, amountIn, priceLimit, recipient, stop);
  return settled(trader[1], recipient, held, before, minOut);
}

// Crema, CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR.
export function crema(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
  stop: Uint256,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xa865993892793f8063d3199efd7fbda5844e3a99b4c73ce660916534b64e4ce6;
  require(owned && slot[0].address == pool.owner, "not a Crema pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapCrema(slot, trader, amountIn, priceLimit, recipient, stop);
  return settled(trader[1], recipient, held, before, minOut);
}

// Phoenix, PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY. Its checks cannot see the book: an order
// whose book has no offer within the limit runs and fills nothing, and returns 0, having moved nothing.
export function phoenix(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x05d0ea4f33737013a563e09348edb6f4593d91fc7641f9247c2441a842a1bbeb;
  require(owned && slot[0].address == pool.owner, "not a Phoenix market");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapPhoenix(slot, trader, amountIn, priceLimit, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// At a limit in the pool's own terms
// ---------------------------------------------------------------------------------------------
//
// `…AtLimit` takes a slot and the trader like the functions above, and the pool's
// own limit in place of `priceLimit`: no fee is read for it and no root taken, and the instruction is
// the one a caller would build by hand for that limit, `minOut` in the venue's own floor where its
// instruction has one. `…Cpi` is that instruction alone, on the accounts the caller lists in the
// venue's own order: it checks nothing but the program, reads nothing but the paying account, and
// returns what that account paid. `…AtLimit` builds its data with the venue's `…Data`; `…Cpi`
// writes the same bytes itself, which costs it about 2k compute units less than calling `…Data`
// (Phoenix's excepted).

// The checks a Raydium-layout pool's `…AtLimit` makes past its program and owner: swaps on, and
// the pool able to trade toward the limit, dust judged at its config's rate (fees a Byreal pool adds
// on top only make dust more likely).
function canRaydium(
  slot: Account[],
  pay: Uint256,
  buy: Uint256,
  amountIn: Uint256,
  limit: Uint256,
): bool {
  const pool = slot[1];
  if ((svm.sload(pool, 389, 1).toLe() & 16) != 0) {
    return false;
  }
  return clmmCan(
    svm.sload(pool, 73, 32).toBe(),
    svm.sload(pool, 105, 32).toBe(),
    svm.sload(pool, 237, 16).toLe(),
    svm.sload(pool, 253, 16).toLe(),
    svm.sload(slot[2], 47, 4).toLe(),
    pay,
    buy,
    limit,
    amountIn,
  );
}

// A whirlpool's, Orca's and Cropper's: dust judged at the pool's static fee (an adaptive fee only
// adds to it).
function canWhirlpool(
  slot: Account[],
  pay: Uint256,
  buy: Uint256,
  amountIn: Uint256,
  limit: Uint256,
): bool {
  const pool = slot[1];
  return clmmCan(
    svm.sload(pool, 101, 32).toBe(),
    svm.sload(pool, 181, 32).toBe(),
    svm.sload(pool, 49, 16).toLe(),
    svm.sload(pool, 65, 16).toLe(),
    svm.sload(pool, 45, 2).toLe(),
    pay,
    buy,
    limit,
    amountIn,
  );
}

// Raydium CLMM, CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK, at `limit`, its own
// `sqrt_price_limit_x64` (0: the program's own bound).
export function raydiumClmmAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xa5d5ca9e04cf5db590b714ba2fe32cb159133fc1c192b72257fd07d39cb0401e;
  require(owned && slot[0].address == pool.owner, "not a Raydium CLMM pool");
  const pay = trader[2].address;
  const buy = trader[3].address;
  if (!canRaydium(slot, pay, buy, amountIn, limit)) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiRaydium(slot, trader, pay < buy, amountIn, limit, minOut, recipient);
  return settled(source, recipient, held, before, minOut);
}

// Raydium CLMM's `swap_v2` alone. `accounts` in its order: the authority, the pool's `AmmConfig`, the pool,
// the paying and receiving token accounts, the input and output vault, the observation account, SPL
// Token, Token-2022, the memo program, the input and output mint, then the bitmap extension, if
// any, and the tick arrays.
export function raydiumClmmCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xa5d5ca9e04cf5db590b714ba2fe32cb159133fc1c192b72257fd07d39cb0401e, "not a Raydium CLMM pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  const data = swapV2.concat(word.toBytesLe(32), hex`01`);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// PancakeSwap CLMM, HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq: Raydium's code.
export function pancakeswapClmmAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xf9ddcb1fe2f88ebbac5f5b97b4b90ad49551962b89419d765284622845e41cf8;
  require(owned && slot[0].address == pool.owner, "not a PancakeSwap CLMM pool");
  const pay = trader[2].address;
  const buy = trader[3].address;
  if (!canRaydium(slot, pay, buy, amountIn, limit)) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiRaydium(slot, trader, pay < buy, amountIn, limit, minOut, recipient);
  return settled(source, recipient, held, before, minOut);
}

// PancakeSwap CLMM's `swap_v2` alone, `accounts` as `raydiumClmmCpi` takes them.
export function pancakeswapClmmCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xf9ddcb1fe2f88ebbac5f5b97b4b90ad49551962b89419d765284622845e41cf8, "not a PancakeSwap CLMM pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  const data = swapV2.concat(word.toBytesLe(32), hex`01`);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Byreal, REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2: Raydium's code. A limit in the pool's own
// terms holds whatever fees the pool adds, so its pools with fees of their own trade here.
export function byrealAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x0634d20f1bf56dd164e3c13c7836a4229ec5ab21ff54528390a51789f3cdbbdb;
  require(owned && slot[0].address == pool.owner, "not a Byreal pool");
  const pay = trader[2].address;
  const buy = trader[3].address;
  if (!canRaydium(slot, pay, buy, amountIn, limit)) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiRaydium(slot, trader, pay < buy, amountIn, limit, minOut, recipient);
  return settled(source, recipient, held, before, minOut);
}

// Byreal's `swap_v2` alone, `accounts` as `raydiumClmmCpi` takes them.
export function byrealCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x0634d20f1bf56dd164e3c13c7836a4229ec5ab21ff54528390a51789f3cdbbdb, "not a Byreal pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  const data = swapV2.concat(word.toBytesLe(32), hex`01`);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Stabble CLMM, 6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6: Raydium's code.
export function stabbleClmmAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x539a8f14242a332eff95ba037c2c3936689d09da4571718f89491b86302586a3;
  require(owned && slot[0].address == pool.owner, "not a Stabble CLMM pool");
  const pay = trader[2].address;
  const buy = trader[3].address;
  if (!canRaydium(slot, pay, buy, amountIn, limit)) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiRaydium(slot, trader, pay < buy, amountIn, limit, minOut, recipient);
  return settled(source, recipient, held, before, minOut);
}

// Stabble CLMM's `swap_v2` alone, `accounts` as `raydiumClmmCpi` takes them.
export function stabbleClmmCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x539a8f14242a332eff95ba037c2c3936689d09da4571718f89491b86302586a3, "not a Stabble CLMM pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  const data = swapV2.concat(word.toBytesLe(32), hex`01`);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Orca Whirlpools, whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc, at `limit`, its own
// `sqrt_price_limit` (0: the program's own bound). A limit in the pool's own terms holds whatever
// fee the pool charges, so an adaptive-fee pool trades here; it writes its oracle, the slot's
// `extra`, which must then be writable, as it must for any pool its `swap_v2` takes (a Token-2022
// mint), which declares the oracle writable whatever the fee.
export function orcaWhirlpoolAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x0e03685f8e909053e458121c66f5a76aedc7706aa11c82f8aa952a8f2b7879a9;
  require(owned && slot[0].address == pool.owner, "not an Orca whirlpool");
  const pay = trader[2].address;
  const buy = trader[3].address;
  if (!canWhirlpool(slot, pay, buy, amountIn, limit)) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiWhirlpool(slot, trader, pay < buy, amountIn, limit, minOut, recipient);
  return settled(source, recipient, held, before, minOut);
}

// A whirlpool's swap alone, A to B when `aToB`. `accounts` in its order: for the classic `swap` (both
// mints SPL Token's), SPL Token, the authority, the pool, token A's account and vault, token B's,
// the three tick arrays and the oracle; for `swap_v2`, token A's and token B's token programs, the
// memo program, the authority, the pool, mint A, mint B, then as `swap` from token A's account.
export function orcaWhirlpoolCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x0e03685f8e909053e458121c66f5a76aedc7706aa11c82f8aa952a8f2b7879a9, "not an Orca whirlpool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  // Eleven accounts are the classic `swap`'s; `swap_v2` takes fifteen, and says it passes no
  // remaining-accounts info.
  let swap = hex`2b04ed0b1ac91e62`;
  let flags = aToB ? hex`010100` : hex`010000`;
  if (accounts.length == 11) {
    swap = hex`f8c69e91e17587c8`;
    flags = aToB ? hex`0101` : hex`0100`;
  }
  const data = swap.concat(word.toBytesLe(32), flags);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Cropper, H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt: Orca's code. Its program takes no 0 as a
// limit: give it its own bound.
export function cropperAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xefa6e5dfb789ce3db66eccedff9eab02ca6a57cf068746befe835ab4c2f2ee0f;
  require(owned && slot[0].address == pool.owner, "not a Cropper pool");
  const pay = trader[2].address;
  const buy = trader[3].address;
  if (!canWhirlpool(slot, pay, buy, amountIn, limit)) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiCropper(slot, trader, pay < buy, amountIn, limit, minOut, recipient);
  return settled(source, recipient, held, before, minOut);
}

// Cropper's `swap` alone, `accounts` as a whirlpool's classic `swap` takes them.
export function cropperCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xefa6e5dfb789ce3db66eccedff9eab02ca6a57cf068746befe835ab4c2f2ee0f, "not a Cropper pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(word.toBytesLe(32), aToB ? hex`0101` : hex`0100`);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// DefiTuna, fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9, at `limit`, its own `sqrt_price_limit` (0:
// the program's own bound).
export function defitunaAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x09db19e5e1ffb1eba60fcffdafaa314664a12f6cac8af15485b5ddd92b6f3ae6;
  require(owned && slot[0].address == pool.owner, "not a DefiTuna pool");
  const pay = trader[2].address;
  const buy = trader[3].address;
  const ok = clmmCan(
    svm.sload(pool, 11, 32).toBe(),
    svm.sload(pool, 43, 32).toBe(),
    svm.sload(pool, 151, 16).toLe(),
    svm.sload(pool, 167, 16).toLe(),
    svm.sload(pool, 143, 2).toLe(),
    pay,
    buy,
    limit,
    amountIn,
  );
  if (!ok) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiDefituna(slot, trader, pay < buy, amountIn, limit, minOut, recipient);
  return settled(source, recipient, held, before, minOut);
}

// DefiTuna's `swap` alone, A to B when `aToB`. `accounts` in its order: token A's and token B's
// token programs, the memo program, the authority, the pool, mint A, mint B, token A's and token B's
// accounts, vault A, vault B and the three tick arrays.
export function defitunaCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x09db19e5e1ffb1eba60fcffdafaa314664a12f6cac8af15485b5ddd92b6f3ae6, "not a DefiTuna pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(word.toBytesLe(32), aToB ? hex`010100` : hex`010000`);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Crema, CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR, at `limit`, its own `sqrt_price_limit`,
// which its program takes explicitly: give it its own bound, not 0.
export function cremaAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xa865993892793f8063d3199efd7fbda5844e3a99b4c73ce660916534b64e4ce6;
  require(owned && slot[0].address == pool.owner, "not a Crema pool");
  if (svm.sload(pool, 747, 1).toLe() != 0) {
    return 0; // paused
  }
  const pay = trader[2].address;
  const buy = trader[3].address;
  const ok = clmmCan(
    svm.sload(pool, 40, 32).toBe(),
    svm.sload(pool, 72, 32).toBe(),
    svm.sload(pool, 174, 16).toLe(),
    svm.sload(pool, 190, 16).toLe(),
    svm.sload(pool, 172, 2).toLe(),
    pay,
    buy,
    limit,
    amountIn,
  );
  if (!ok) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiCrema(slot, trader, pay < buy, amountIn, limit, minOut, recipient);
  return settled(source, recipient, held, before, minOut);
}

// Crema's `swap` alone, A to B when `aToB`. `accounts` in its order: the `clmm_config`, the pool,
// mint A, mint B, token A's and token B's accounts, vault A, vault B, the tick-array map, the
// authority, SPL Token, then the tick arrays its map marks, in walk order.
export function cremaCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xa865993892793f8063d3199efd7fbda5844e3a99b4c73ce660916534b64e4ce6, "not a Crema pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = aToB ? hex`f8c69e91e17587c80101` : hex`f8c69e91e17587c80001`;
  const data = swap.concat(word.toBytesLe(32));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Phoenix, PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY, at `ticks`, the order's own price in the
// market's ticks (0: none, an order that takes the book at any price, as far as the input goes).
// An order whose book has no offer within it fills nothing, and returns 0, having moved nothing. Its
// instruction carries no least out: the recipient's balance is held to `minOut`.
export function phoenixAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  ticks: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x05d0ea4f33737013a563e09348edb6f4593d91fc7641f9247c2441a842a1bbeb;
  require(owned && slot[0].address == pool.owner, "not a Phoenix market");
  require(ticks <= 0xffffffffffffffff, "limit past 64 bits");
  if (svm.sload(pool, 8, 8).toLe() != 1) {
    return 0; // not open for taking: post-only, paused or closed
  }
  const paysBase = svm.sload(pool, 48, 32).toBe() == trader[2].address;
  const buy = trader[3].address;
  require(svm.sload(pool, paysBase ? 128 : 48, 32).toBe() == buy, "market is not the pair");
  const lot = svm.sload(pool, paysBase ? 112 : 192, 8).toLe();
  if (amountIn < lot) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiPhoenix(slot, trader, paysBase, amountIn, lot, ticks, recipient);
  return settled(source, recipient, held, before, minOut);
}

// Phoenix's immediate-or-cancel order alone, selling base when `paysBase`. `accounts` in its order:
// the program, the log authority, the market, the authority, the base and quote token accounts, the
// base and quote vaults, SPL Token. It carries no least out.
export function phoenixCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  ticks: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0x05d0ea4f33737013a563e09348edb6f4593d91fc7641f9247c2441a842a1bbeb, "not a Phoenix market");
  // The market's lot size of the token paid: the market is the instruction's third account. Under one
  // lot, no order.
  const lot = svm.sload(accounts[2], paysBase ? 112 : 192, 8).toLe();
  if (amountIn < lot) {
    return 0;
  }
  const data = phoenixData(amountIn, lot, ticks, paysBase);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Invariant, HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt, at `limit`, its own `sqrt_price_limit`: a
// price square root times 10^24, not Q64.64 (0: none, which its program takes only selling token
// X). Its program does not stop there: a swap that reaches the limit with input left is refused
// (custom error 0x1778), and the whole transaction with it, so `amountIn` must fit inside the limit.
// Its instruction carries no least out: the recipient's balance is held to `minOut`.
export function invariantAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xfc39066f804ec84d465acc0cafceb1debdfb9e4751e3c99ecb5463ac63cd89c9;
  require(owned && slot[0].address == pool.owner, "not an Invariant pool");
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  // Token X and Y, the liquidity and the price root: a pool with no liquidity at its price, or its
  // price already at or past the limit, has nothing to trade; an input that buys under one unit at
  // the price after the pool's fee (10^12 is all of it) buys nothing.
  const tokenX = svm.sload(pool, 8, 32).toBe();
  const tokenY = svm.sload(pool, 40, 32).toBe();
  const paysX = tokenX == trader[2].address;
  const buy = trader[3].address;
  require(paysX
    ? tokenY == buy
    : tokenX == buy && tokenY == trader[2].address, "pool is not the pair");
  const price = svm.sload(pool, 202, 16).toLe();
  const kept = (amountIn * (10 ** 12 - svm.sload(pool, 154, 16).toLe())) / 10 ** 12;
  const square = price * price; // a root under 2^96, so its square fits
  if (
    svm.sload(pool, 186, 16).toLe() == 0 ||
    (paysX ? kept * square < 10 ** 48 : kept * 10 ** 48 < square) ||
    (limit != 0 && (paysX ? price <= limit : price >= limit))
  ) {
    return 0;
  }
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiInvariant(slot, trader, amountIn, limit, paysX, recipient);
  return settled(source, recipient, held, before, minOut);
}

// Invariant's `swap` alone, selling token X when `xToY`. `accounts` in its order: the program's state,
// the pool, its tickmap, the X and Y token accounts, the X and Y reserves, the authority, the
// program's authority, SPL Token, then the ticks the swap may cross. It carries no least out.
export function invariantCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  limit: Uint256,
  xToY: bool,
): Uint256 {
  require(program.address ==
    0xfc39066f804ec84d465acc0cafceb1debdfb9e4751e3c99ecb5463ac63cd89c9, "not an Invariant pool");
  const swap = xToY ? hex`f8c69e91e17587c801` : hex`f8c69e91e17587c800`;
  require(limit <= 0xffffffffffffffffffffffffffffffff, "limit past 128 bits");
  const word = (amountIn & 0xffffffffffffffff) | (1 << 64) | (limit << 72);
  const data = swap.concat(word.toBytesLe(25));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Manifest, MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms: its swap takes no price limit, so neither do
// these; it takes the book as far as the input goes. `minOut` is its own least out.
export function manifest(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const market = slot[1];
  if (market.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = market.owner == 0x0537a47738da25a988f964d99ba43a88cf1187395b6acf1483f570228d8002b2;
  require(owned && slot[0].address == market.owner, "not a Manifest market");
  const base = svm.sload(market, 16, 32).toBe();
  const quote = svm.sload(market, 48, 32).toBe();
  const paysBase = base == trader[2].address;
  require(paysBase
    ? quote == trader[3].address
    : base == trader[3].address && quote == trader[2].address, "market is not the pair");
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiManifest(slot, trader, amountIn, minOut, paysBase, recipient);
  return settled(source, recipient, held, before, minOut);
}

// Manifest's `Swap` alone, selling base when `paysBase`. `accounts` in its order: the authority (it
// pays and signs), the market, the System program, the base and quote token accounts, the base and
// quote vaults, the base token program, the base mint, the quote token program, the quote mint.
export function manifestCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0x0537a47738da25a988f964d99ba43a88cf1187395b6acf1483f570228d8002b2, "not a Manifest market");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word =
    (paysBase ? 0x1010000000000000000000000000000000004 : 0x1000000000000000000000000000000000004) |
    ((amountIn & 0xffffffffffffffff) << 8) |
    (minOut << 72);
  const data = word.toBytesLe(19);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// OpenBook v2, opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb, at `priceLots`, the order's own price in
// the market's lots (0: a market order, at any price), matching at most `orders` resting orders. An
// order whose book has no offer within it fills nothing, and returns 0. Its instruction carries no
// least out: the recipient's balance is held to `minOut`.
export function openbookV2AtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLots: Uint256,
  orders: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const market = slot[1];
  if (market.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = market.owner == 0x0bfebfbdfbabfad0b46571bf958c1eb824787bb0994bb1846b2978071e1799be;
  require(owned && slot[0].address == market.owner, "not an OpenBook v2 market");
  require(priceLots <= 0x7fffffffffffffff && orders <= 255, "limit past its field");
  const base = svm.sload(market, 576, 32).toBe();
  const quote = svm.sload(market, 608, 32).toBe();
  const paysBase = base == trader[2].address;
  require(paysBase
    ? quote == trader[3].address
    : base == trader[3].address && quote == trader[2].address, "market is not the pair");
  const source = trader[1];
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiOpenbookV2(slot, trader, amountIn, priceLots, orders, paysBase, recipient);
  return settled(source, recipient, held, before, minOut);
}

// OpenBook v2's `place_take_order` alone, selling base when `paysBase`. `accounts` in its order: the
// authority (signer and penalty payer, twice), the market, its authority, bids, asks, the base and
// quote vaults, the event heap, the base and quote token accounts, the two oracles (the program for
// one it has not), SPL Token, the System program, the program (no open-orders admin). It carries no
// least out.
export function openbookV2Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  priceLots: Uint256,
  orders: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0x0bfebfbdfbabfad0b46571bf958c1eb824787bb0994bb1846b2978071e1799be, "not an OpenBook v2 market");
  // The market is the instruction's third account: its lot sizes size the order, and the side not
  // paid is unbounded.
  const market = accounts[2];
  const quoteLot = svm.sload(market, 448, 8).toLe();
  const baseLot = svm.sload(market, 456, 8).toLe();
  const most = 0x7fffffffffffffff;
  const baseLots = paysBase ? amountIn / baseLot : most / baseLot;
  const quoteLots = paysBase ? most / quoteLot : amountIn / quoteLot;
  require((priceLots | baseLots | quoteLots) <= 0x7fffffffffffffff &&
    orders <= 255, "limit past its field");
  const order =
    priceLots == 0
      ? 0x300000000000000000000000000000000000000000000000100
      : (priceLots << 8) | 0x100000000000000000000000000000000000000000000000000;
  const take = hex`032c47031ac7cb55`;
  const word =
    order |
    (paysBase ? (orders << 208) | 1 : orders << 208) |
    (baseLots << 72) |
    (quoteLots << 136);
  const data = take.concat(word.toBytesLe(27));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// =============================================================================================
// EXACT INPUT
// =============================================================================================
//
// Every function below is a MARKET ORDER at one pool: it pays exactly `amountIn` and takes what the
// pool gives for it, with no price limit, or the transaction fails. Three forms of each venue:
//
//   <venue>(slot, trader, amountIn, minOut, recipient): Uint256
//   <venue>Cpi(program, accounts, source, amountIn, …, minOut, <direction>): Uint256
//   <venue>Data(amountIn, …, minOut, <direction>): bytes
//
// `<venue>Data` is the venue's instruction data, and `<venue>Cpi` sends it on the caller's accounts,
// both as the limit functions' are (the `…Cpi`/`…Data` contract in this file's header): the
// accounts in the venue's own order, which `@eco-incorp/sauce/svm`'s `routerSvmAccountOrder` names
// and `routerSvmAccounts` builds; `…Cpi` checks the program, reads only `source`, and returns what
// `source` paid. `minOut` is the venue's own least out, written as given; a venue whose swap carries
// none takes no `minOut` in these two. The direction is an argument where the data says it (`aToB`
// paying the pool's first token, `paysBase` the base token, `xToY` token X), and absent where the
// accounts alone say it. Every form sends the same bytes for the same amount, floor and direction.
//
// `<venue>` takes a slot instead and reads the direction from it: `trader` and
// `recipient` are the limit functions' own, and `slot` is the venue's own accounts, its program
// first, the pool second, then the rest in the order each venue's comment gives. Where a pool keeps
// an account per token (its vaults, a fee account), the slot carries both in the POOL's order and
// the function works out which is paid from `payMint`, so one slot serves both ways. Each token's
// program is the one that owns its mint (`tokenProgram` or `token2022`). `<venue>` returns 0, having
// moved nothing, for what it can see before the swap: a missing slot (the System program as its
// pool), no input, and the venue's own refusals its comment names; otherwise it swaps, or the
// transaction fails, and returns what the recipient received, held to `minOut` and at least 1, which
// it also writes into the venue's least out. A function reading its accounts
// out of `slot` and `trader` cannot hand over more than sixteen, seventeen filled in place (Meteora
// DLMM's): a venue whose swap takes more has only its `Cpi` and `Data` forms.
//
// A swap spends exactly `amountIn` unless its venue's comment says otherwise. Every form but `Data`
// requires the program to be its venue's before the authority signs into it ("not a <venue> pool"),
// and a `minOut` past the venues' 64 bits reverts ("minOut past 64 bits"); `amountIn` is written as
// its low 64 bits. A pool of another venue, or one that is not the pair, is the venue's own to
// refuse, and fails the transaction.

// Raydium CP-Swap, CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: `swap_base_input`. The slot is
// `[program, pool, authority, ammConfig, vault0, vault1, observation]`; token 0 is the lower-key
// mint, which the program requires of every pool.
function swapRaydiumCp(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xa92a5a8b4f295952842550aa93fd5b95b5ace6a8eb920c93942e43690c20ec73, "not a Raydium CP pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = payMint.address < buyMint.address;
  svm.call(
    program,
    [
      trader[0],
      slot[2],
      slot[3],
      slot[1],
      trader[1],
      recipient,
      paysA ? slot[4] : slot[5],
      paysA ? slot[5] : slot[4],
      payMint.owner == token2022.address ? token2022 : tokenProgram,
      buyMint.owner == token2022.address ? token2022 : tokenProgram,
      payMint,
      buyMint,
      slot[6],
    ],
    raydiumCpSwapData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Raydium CP-Swap's `swap_base_input`: exact input of `amountIn`, `minOut` its least out.
export function raydiumCpSwapData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`8fbe5adac41e33de`;
  return ix.concat(word.toBytesLe(16));
}

// Skips swaps switched off (status bit 2), a pool not open yet, an empty side, and dust.
export function raydiumCpSwap(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xa92a5a8b4f295952842550aa93fd5b95b5ace6a8eb920c93942e43690c20ec73;
  require(pool.owner == id, "not a Raydium CP pool");
  const paysA = trader[2].address < trader[3].address;
  const vaultIn = svm.sload(paysA ? slot[4] : slot[5], 64, 8).toLe();
  const vaultOut = svm.sload(paysA ? slot[5] : slot[4], 64, 8).toLe();
  const kept = amountIn - (amountIn * svm.sload(slot[3], 12, 8).toLe() + 999999) / 1000000;
  if (
    (svm.sload(pool, 329, 1).toLe() & 4) != 0 ||
    svm.sload(pool, 373, 8).toLe() > ctx.timestamp() ||
    vaultOut == 0 ||
    kept * vaultOut < vaultIn
  ) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapRaydiumCp(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the pool's `AmmConfig`, the pool, the paying and receiving token accounts, the input and
// output vault, each side's token program, the input and output mint, and the observation account.
export function raydiumCpSwapCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xa92a5a8b4f295952842550aa93fd5b95b5ace6a8eb920c93942e43690c20ec73, "not a Raydium CP pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`8fbe5adac41e33de`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Gamma, GAMMA7meSFWaBXF25oSUgmGRwaW6sCMFLmBNiMSdbHVT: Raydium CP-Swap's code, slot and accounts,
// its own `swap_base_input`. Its fee rises with volatility: the dust estimate takes its highest.
function swapGamma(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xe14489c834bda18e955811c8e496a949a83ab9eda376e14580f37fd5b4593162, "not a Gamma pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = payMint.address < buyMint.address;
  svm.call(
    program,
    [
      trader[0],
      slot[2],
      slot[3],
      slot[1],
      trader[1],
      recipient,
      paysA ? slot[4] : slot[5],
      paysA ? slot[5] : slot[4],
      payMint.owner == token2022.address ? token2022 : tokenProgram,
      buyMint.owner == token2022.address ? token2022 : tokenProgram,
      payMint,
      buyMint,
      slot[6],
    ],
    gammaData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Gamma's `swap_base_input`, Raydium CP-Swap's under its own name.
export function gammaData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`ef52c0bba01adfdf`;
  return ix.concat(word.toBytesLe(16));
}

// Skips swaps switched off (status bit 2), a pool not open yet, an empty side, and dust.
export function gamma(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xe14489c834bda18e955811c8e496a949a83ab9eda376e14580f37fd5b4593162;
  require(pool.owner == id, "not a Gamma pool");
  const paysA = trader[2].address < trader[3].address;
  const vaultIn = svm.sload(paysA ? slot[4] : slot[5], 64, 8).toLe();
  const vaultOut = svm.sload(paysA ? slot[5] : slot[4], 64, 8).toLe();
  const kept = amountIn - (amountIn * svm.sload(pool, 461, 8).toLe() + 999999) / 1000000;
  if (
    (svm.sload(pool, 329, 1).toLe() & 4) != 0 ||
    svm.sload(pool, 373, 8).toLe() > ctx.timestamp() ||
    vaultOut == 0 ||
    kept * vaultOut < vaultIn
  ) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapGamma(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: as Raydium CP-Swap's.
export function gammaCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xe14489c834bda18e955811c8e496a949a83ab9eda376e14580f37fd5b4593162, "not a Gamma pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`ef52c0bba01adfdf`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Raydium AMM v4, 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8: `swap_base_in_v2`, the swap that
// takes no order-book accounts. The slot is `[program, pool, authority, coinVault, pcVault]`; the
// program reads the direction from the paying and receiving accounts. Classic SPL tokens only.
function swapRaydiumAmmV4(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x4bd949c43602c33f207790ed16a3524ca1b9975cf121a2a90cffec7df8b68acd, "not a Raydium AMM v4 pool");
  svm.call(
    program,
    [trader[4], slot[1], slot[2], slot[3], slot[4], trader[1], recipient, trader[0]],
    raydiumAmmV4Data(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Raydium AMM v4's `swap_base_in_v2`: exact input of `amountIn`, `minOut` its least out.
export function raydiumAmmV4Data(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`10`;
  return ix.concat(word.toBytesLe(16));
}

// Skips a pool that does not swap (a status other than 1, 6 or 7, or 7 before its open time), an
// empty side, and dust.
export function raydiumAmmV4(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x4bd949c43602c33f207790ed16a3524ca1b9975cf121a2a90cffec7df8b68acd;
  require(pool.owner == id, "not a Raydium AMM v4 pool");
  const status = svm.sload(pool, 0, 8).toLe();
  const paysCoin = svm.sload(pool, 400, 32).toBe() == trader[2].address;
  const vaultIn = svm.sload(paysCoin ? slot[3] : slot[4], 64, 8).toLe();
  const vaultOut = svm.sload(paysCoin ? slot[4] : slot[3], 64, 8).toLe();
  const denominator = svm.sload(pool, 184, 8).toLe();
  const kept = (amountIn * (denominator - svm.sload(pool, 176, 8).toLe())) / denominator;
  if (
    (status != 1 && status != 6 && status != 7) ||
    (status == 7 && svm.sload(pool, 224, 8).toLe() > ctx.timestamp()) ||
    vaultOut == 0 ||
    kept * vaultOut < vaultIn
  ) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapRaydiumAmmV4(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: SPL Token, the pool, its authority, the coin and pc vaults, the paying and receiving
// token accounts, and the authority.
export function raydiumAmmV4Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x4bd949c43602c33f207790ed16a3524ca1b9975cf121a2a90cffec7df8b68acd, "not a Raydium AMM v4 pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`10`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// The SPL Token Swap program's `swap`, as Orca's legacy pools and five forks of it run it. The slot
// is `[program, pool, authority, vaultA, vaultB, poolMint, poolFeeAccount]`; which vault is paid is
// read from vault A's mint. Classic SPL tokens only. The program spends what its curve rounds the
// input to, which can be a few units under `amountIn`; the rest stays in the paying account. The
// program id is the caller's to have checked.
function swapTokenSwap(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const vaultA = slot[3];
  const vaultB = slot[4];
  const paysA = svm.sload(vaultA, 0, 32).toBe() == trader[2].address;
  svm.call(
    slot[0],
    [
      slot[1],
      slot[2],
      trader[0],
      trader[1],
      paysA ? vaultA : vaultB,
      paysA ? vaultB : vaultA,
      recipient,
      slot[5],
      slot[6],
      trader[4],
    ],
    tokenSwapV1Data(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// An uninitialized Token Swap pool, an empty side or dust: true to skip.
function tokenSwapSkips(slot: Account[], trader: Account[], amountIn: Uint256): bool {
  const paysA = svm.sload(slot[3], 0, 32).toBe() == trader[2].address;
  const vaultIn = svm.sload(paysA ? slot[3] : slot[4], 64, 8).toLe();
  const vaultOut = svm.sload(paysA ? slot[4] : slot[3], 64, 8).toLe();
  return svm.sload(slot[1], 1, 1).toLe() != 1 || vaultOut == 0 || amountIn * vaultOut < vaultIn;
}

// The Token Swap program's Token-2022 build, as Fluxbeam and Dexlab run it: `swap` with both mints,
// each side's token program and the pool mint's. The slot is the Token Swap one.
function swapTokenSwap2022(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const vaultA = slot[3];
  const vaultB = slot[4];
  const poolMint = slot[5];
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = svm.sload(vaultA, 0, 32).toBe() == payMint.address;
  svm.call(
    slot[0],
    [
      slot[1],
      slot[2],
      trader[0],
      trader[1],
      paysA ? vaultA : vaultB,
      paysA ? vaultB : vaultA,
      recipient,
      poolMint,
      slot[6],
      payMint,
      buyMint,
      payMint.owner == token2022.address ? token2022 : tokenProgram,
      buyMint.owner == token2022.address ? token2022 : tokenProgram,
      poolMint.owner == token2022.address ? token2022 : tokenProgram,
    ],
    tokenSwapV1Data(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Orca's legacy pools, 9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP, constant-product and stable:
// Token Swap.
// Orca's legacy pools' `swap`: exact input of `amountIn`, `minOut` its least out.
export function orcaLegacyTokenSwapData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an uninitialized pool, an empty side, and dust.
export function orcaLegacyTokenSwap(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x7e54771a57a6f14ca9e402d54aee45f7378aca365c7b169a7ec83f5182b298f0;
  require(pool.owner == id && slot[0].address == id, "not an Orca legacy pool");
  if (tokenSwapSkips(slot, trader, amountIn)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTokenSwap(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and output vault,
// the receiving token account, the pool mint, the pool fee account, and SPL Token.
export function orcaLegacyTokenSwapCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x7e54771a57a6f14ca9e402d54aee45f7378aca365c7b169a7ec83f5182b298f0, "not an Orca legacy pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// The SPL Token Swap program itself, SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8.
// The Token Swap program's `swap`: exact input of `amountIn`, `minOut` its least out.
export function tokenSwapV1Data(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an uninitialized pool, an empty side, and dust.
export function tokenSwapV1(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x06a53aae36bf486fb5d938264ee645d74b6016e0f47aebb3ec16438bf7bffbe1;
  require(pool.owner == id && slot[0].address == id, "not a Token Swap pool");
  if (tokenSwapSkips(slot, trader, amountIn)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTokenSwap(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and output vault,
// the receiving token account, the pool mint, the pool fee account, and SPL Token.
export function tokenSwapV1Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x06a53aae36bf486fb5d938264ee645d74b6016e0f47aebb3ec16438bf7bffbe1, "not a Token Swap pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Orca v1, DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1: Token Swap.
// Orca v1's `swap`: exact input of `amountIn`, `minOut` its least out.
export function orcaV1Data(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an uninitialized pool, an empty side, and dust.
export function orcaV1(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xbd2e8d50bc09278e5e14bf65629a4896f5819ecac40f50c84b757847ba9464dc;
  require(pool.owner == id && slot[0].address == id, "not an Orca v1 pool");
  if (tokenSwapSkips(slot, trader, amountIn)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTokenSwap(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and output vault,
// the receiving token account, the pool mint, the pool fee account, and SPL Token.
export function orcaV1Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xbd2e8d50bc09278e5e14bf65629a4896f5819ecac40f50c84b757847ba9464dc, "not an Orca v1 pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Penguin, PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP: Token Swap.
// Penguin's `swap`: exact input of `amountIn`, `minOut` its least out.
export function penguinData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an uninitialized pool, an empty side, and dust.
export function penguin(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x05c01c06e46f4190c7755e2c25ed0cd6b204441e1d128b79df6118292787613c;
  require(pool.owner == id && slot[0].address == id, "not a Penguin pool");
  if (tokenSwapSkips(slot, trader, amountIn)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTokenSwap(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and output vault,
// the receiving token account, the pool mint, the pool fee account, and SPL Token.
export function penguinCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x05c01c06e46f4190c7755e2c25ed0cd6b204441e1d128b79df6118292787613c, "not a Penguin pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// STEPN's Dooar, Dooar9JkhdZ7J3LHN3A7YCuoGRUggXhQaG4kijfLGU2j: Token Swap.
// STEPN's `swap`: exact input of `amountIn`, `minOut` its least out.
export function stepnData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an uninitialized pool, an empty side, and dust.
export function stepn(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xbe49a1eeb81bf889c158fd8b7496ff9141d4aa433eae3948d0d8488f78951b78;
  require(pool.owner == id && slot[0].address == id, "not a STEPN pool");
  if (tokenSwapSkips(slot, trader, amountIn)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTokenSwap(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and output vault,
// the receiving token account, the pool mint, the pool fee account, and SPL Token.
export function stepnCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xbe49a1eeb81bf889c158fd8b7496ff9141d4aa433eae3948d0d8488f78951b78, "not a STEPN pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Saros, SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr: Token Swap.
// Saros's `swap`: exact input of `amountIn`, `minOut` its least out.
export function sarosData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an uninitialized pool, an empty side, and dust.
export function saros(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x0684da16a689c2c3896a8411715be9432eec1ca71a1ce2087286c67677cf65bd;
  require(pool.owner == id && slot[0].address == id, "not a Saros pool");
  if (tokenSwapSkips(slot, trader, amountIn)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTokenSwap(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and output vault,
// the receiving token account, the pool mint, the pool fee account, and SPL Token.
export function sarosCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x0684da16a689c2c3896a8411715be9432eec1ca71a1ce2087286c67677cf65bd, "not a Saros pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Fluxbeam, FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X: Token Swap for Token-2022. A mint with a
// transfer fee keeps the fee out of what the pool receives.
// Fluxbeam's `swap`: exact input of `amountIn`, `minOut` its least out.
export function fluxbeamData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an uninitialized pool, an empty side, and dust.
export function fluxbeam(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xd500c8ab3ffad0a86bab5f536531c6dd5e62b0626d33cdeddf82ead7eec50e46;
  require(pool.owner == id && slot[0].address == id, "not a Fluxbeam pool");
  if (tokenSwapSkips(slot, trader, amountIn)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTokenSwap2022(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and output vault,
// the receiving token account, the pool mint, the pool fee account, the input and output mint, and
// the input's, the output's and the pool mint's token program.
export function fluxbeamCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xd500c8ab3ffad0a86bab5f536531c6dd5e62b0626d33cdeddf82ead7eec50e46, "not a Fluxbeam pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Dexlab, DSwpgjMvXhtGn6BsbqmacdBZyfLj6jSWf3HJpdJtmg6N: Token Swap for Token-2022.
// Dexlab's `swap`: exact input of `amountIn`, `minOut` its least out.
export function dexlabData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an uninitialized pool, an empty side, and dust.
export function dexlab(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xb8f1c03e5ed760c8ed35ab17b673ccf00f9f3a9fca650c81e2c66f078a16b1e3;
  require(pool.owner == id && slot[0].address == id, "not a Dexlab pool");
  if (tokenSwapSkips(slot, trader, amountIn)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTokenSwap2022(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and output vault,
// the receiving token account, the pool mint, the pool fee account, the input and output mint, and
// the input's, the output's and the pool mint's token program.
export function dexlabCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xb8f1c03e5ed760c8ed35ab17b673ccf00f9f3a9fca650c81e2c66f078a16b1e3, "not a Dexlab pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Meteora DAMM v2, cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: `swap`, with no referral account
// (the program itself, Anchor's empty optional). The slot is `[program, pool, authority, vaultA,
// vaultB, eventAuthority]`; which vault is paid is read from vault A's mint.
function swapMeteoraDammV2(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x092d2135657a159c2b87d4b66a70db8e9752389ff76aaf206ced063a38f95aed, "not a Meteora DAMM v2 pool");
  const vaultA = slot[3];
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = svm.sload(vaultA, 0, 32).toBe() == payMint.address;
  const mintA = paysA ? payMint : buyMint;
  const mintB = paysA ? buyMint : payMint;
  svm.call(
    program,
    [
      slot[2],
      slot[1],
      trader[1],
      recipient,
      vaultA,
      slot[4],
      mintA,
      mintB,
      trader[0],
      mintA.owner == token2022.address ? token2022 : tokenProgram,
      mintB.owner == token2022.address ? token2022 : tokenProgram,
      program,
      slot[5],
      program,
    ],
    meteoraDammV2Data(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Meteora DAMM v2's `swap`: exact input of `amountIn`, `minOut` its least out.
export function meteoraDammV2Data(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c8`;
  return ix.concat(word.toBytesLe(16));
}

// Skips a disabled pool (pool_status) and one with no liquidity.
export function meteoraDammV2(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x092d2135657a159c2b87d4b66a70db8e9752389ff76aaf206ced063a38f95aed;
  require(pool.owner == id, "not a Meteora DAMM v2 pool");
  if (svm.sload(pool, 481, 1).toLe() != 0 || svm.sload(pool, 360, 16).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapMeteoraDammV2(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool authority, the pool, the paying and receiving token accounts, vaults A and
// B, mints A and B, the authority, A's and B's token program, the program (no referral), the event
// authority, and the program.
export function meteoraDammV2Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x092d2135657a159c2b87d4b66a70db8e9752389ff76aaf206ced063a38f95aed, "not a Meteora DAMM v2 pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c8`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Meteora DAMM v1, Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB, constant-product and stable pools:
// `swap`, each token held in a Meteora vault. The slot is `[program, pool, aVault, bVault,
// aTokenVault, bTokenVault, aVaultLpMint, bVaultLpMint, aVaultLp, bVaultLp, protocolFeeA,
// protocolFeeB, vaultProgram]`; which side is paid is read from A's token vault's mint, and the
// protocol fee account is the paid side's. Classic SPL tokens only.
function swapMeteoraDammV1(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xccf802d4cccc84d7fb21b5f73b49d81a16c5b4c88ee32394e1c91d3588cc4080, "not a Meteora DAMM v1 pool");
  const paysA = svm.sload(slot[4], 0, 32).toBe() == trader[2].address;
  svm.call(
    program,
    [
      slot[1],
      trader[1],
      recipient,
      slot[2],
      slot[3],
      slot[4],
      slot[5],
      slot[6],
      slot[7],
      slot[8],
      slot[9],
      paysA ? slot[10] : slot[11],
      trader[0],
      slot[12],
      trader[4],
    ],
    meteoraDammV1Data(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Meteora DAMM v1's `swap`: exact input of `amountIn`, `minOut` its least out.
export function meteoraDammV1Data(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c8`;
  return ix.concat(word.toBytesLe(16));
}

// Skips a disabled pool (`enabled` cleared).
export function meteoraDammV1(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xccf802d4cccc84d7fb21b5f73b49d81a16c5b4c88ee32394e1c91d3588cc4080;
  require(pool.owner == id, "not a Meteora DAMM v1 pool");
  if (svm.sload(pool, 233, 1).toLe() != 1) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapMeteoraDammV1(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, the paying and receiving token accounts, the A and B vaults, their token
// vaults, LP mints and the pool's LP accounts in them, the paid side's protocol fee account, the
// authority, the vault program, and SPL Token.
export function meteoraDammV1Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xccf802d4cccc84d7fb21b5f73b49d81a16c5b4c88ee32394e1c91d3588cc4080, "not a Meteora DAMM v1 pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c8`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Aldrin, AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6: `swap`, its side byte 1 selling the base
// token. The slot is `[program, pool, poolSigner, poolMint, baseVault, quoteVault, feeAccount]`;
// which side is paid is read from the base vault's mint. Classic SPL tokens only. The program can
// spend a few units under `amountIn`; the rest stays in the paying account.
function swapAldrin(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x8aef7df7e3a674a43ed18156220e0306fa47878b93207e2495e59eedbbda4ca1, "not an Aldrin pool");
  const source = trader[1];
  const sellsBase = svm.sload(slot[4], 0, 32).toBe() == trader[2].address;
  svm.call(
    program,
    [
      slot[1],
      slot[2],
      slot[3],
      slot[4],
      slot[5],
      slot[6],
      trader[0],
      sellsBase ? source : recipient,
      sellsBase ? recipient : source,
      trader[4],
    ],
    aldrinData(amountIn, minOut == 0 ? 1 : minOut, sellsBase),
  );
}

// Aldrin's `swap`: exact input of `amountIn`, `minOut` its least out, selling base (an ask) when
// `paysBase`.
export function aldrinData(amountIn: Uint256, minOut: Uint256, paysBase: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((paysBase ? 1 : 0) << 128);
  const ix = hex`f8c69e91e17587c8`;
  return ix.concat(word.toBytesLe(17));
}

// Skips an empty side, and dust.
export function aldrin(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x8aef7df7e3a674a43ed18156220e0306fa47878b93207e2495e59eedbbda4ca1;
  require(pool.owner == id, "not an Aldrin pool");
  const sellsBase = svm.sload(slot[4], 0, 32).toBe() == trader[2].address;
  const vaultIn = svm.sload(sellsBase ? slot[4] : slot[5], 64, 8).toLe();
  const vaultOut = svm.sload(sellsBase ? slot[5] : slot[4], 64, 8).toLe();
  if (vaultOut == 0 || amountIn * vaultOut < vaultIn) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapAldrin(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its signer, the pool mint, the base and quote vaults, the fee account, the
// authority, the base and quote token accounts (the paying one among them), and SPL Token. It sells
// the base token when `paysBase`.
export function aldrinCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0x8aef7df7e3a674a43ed18156220e0306fa47878b93207e2495e59eedbbda4ca1, "not an Aldrin pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((paysBase ? 1 : 0) << 128);
  const ix = hex`f8c69e91e17587c8`;
  const data = ix.concat(word.toBytesLe(17));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Omnipair, omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE: `swap`. The slot is `[program, pair,
// rateModel, futarchyAuthority, vault0, vault1, eventAuthority]`; which vault is paid is read from
// vault 0's mint.
function swapOmnipair(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x0bfb5c0b720363b6337e4f836daeb9635f97d4176295ae9aae5661f350fd36cf, "not an Omnipair pair");
  const vault0 = slot[4];
  const vault1 = slot[5];
  const paysA = svm.sload(vault0, 0, 32).toBe() == trader[2].address;
  svm.call(
    program,
    [
      slot[1],
      slot[2],
      slot[3],
      paysA ? vault0 : vault1,
      paysA ? vault1 : vault0,
      trader[1],
      recipient,
      trader[2],
      trader[3],
      trader[0],
      trader[4],
      trader[5],
      slot[6],
      program,
    ],
    omnipairData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Omnipair's `swap`: exact input of `amountIn`, `minOut` its least out.
export function omnipairData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c8`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an empty side, and dust.
export function omnipair(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x0bfb5c0b720363b6337e4f836daeb9635f97d4176295ae9aae5661f350fd36cf;
  require(pool.owner == id, "not an Omnipair pair");
  const paysA = svm.sload(slot[4], 0, 32).toBe() == trader[2].address;
  const vaultIn = svm.sload(paysA ? slot[4] : slot[5], 64, 8).toLe();
  const vaultOut = svm.sload(paysA ? slot[5] : slot[4], 64, 8).toLe();
  if (vaultOut == 0 || amountIn * vaultOut < vaultIn) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapOmnipair(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pair, its rate model, the futarchy authority, the input and output vault, the
// paying and receiving token accounts, the input and output mint, the authority, SPL Token,
// Token-2022, the event authority, and the program.
export function omnipairCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x0bfb5c0b720363b6337e4f836daeb9635f97d4176295ae9aae5661f350fd36cf, "not an Omnipair pair");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c8`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Saber, SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ: the stable swap's `swap`. The slot is
// `[program, pool, authority, vaultA, vaultB, adminFeeA, adminFeeB]`; which vault is paid is read
// from vault A's mint, and the admin fee account is the bought side's. Classic SPL tokens only.
function swapSaber(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x0684db496cfadfe7d5a1d18cd39b96cd3c88db6484c1bc75681839119b6affb6, "not a Saber pool");
  const vaultA = slot[3];
  const vaultB = slot[4];
  const paysA = svm.sload(vaultA, 0, 32).toBe() == trader[2].address;
  svm.call(
    program,
    [
      slot[1],
      slot[2],
      trader[0],
      trader[1],
      paysA ? vaultA : vaultB,
      paysA ? vaultB : vaultA,
      recipient,
      paysA ? slot[6] : slot[5],
      trader[4],
    ],
    saberData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Saber's `swap`: exact input of `amountIn`, `minOut` its least out.
export function saberData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  return ix.concat(word.toBytesLe(16));
}

// Skips a paused pool and an empty side.
export function saber(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x0684db496cfadfe7d5a1d18cd39b96cd3c88db6484c1bc75681839119b6affb6;
  require(pool.owner == id, "not a Saber pool");
  const paysA = svm.sload(slot[3], 0, 32).toBe() == trader[2].address;
  if (
    svm.sload(pool, 1, 1).toLe() != 0 ||
    svm.sload(paysA ? slot[4] : slot[3], 64, 8).toLe() == 0
  ) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapSaber(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, its authority, the authority, the paying token account, the input and
// output vault, the receiving token account, the output side's admin fee account, and SPL Token.
export function saberCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x0684db496cfadfe7d5a1d18cd39b96cd3c88db6484c1bc75681839119b6affb6, "not a Saber pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`01`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Saber's decimal wrapper, DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB: `deposit` paying the
// underlying token, `withdraw` paying the wrapped one, each at the wrapper's fixed rate and with no
// floor of its own. The slot is `[program, wrapper, wrapperMint, underlyingVault]`. Classic SPL
// tokens only.
function swapSaberDecimalsWrapper(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xbbeef1254d2fff3d6dcc6ebd8b771b84bd4a8f5146dd33b630481434a66592ae, "not a Saber decimal wrapper");
  const wrapperMint = slot[2];
  const source = trader[1];
  if (trader[2] == wrapperMint) {
    svm.call(
      program,
      [slot[1], wrapperMint, slot[3], trader[0], recipient, source, trader[4]],
      saberDecimalsWrapperData(amountIn, false),
    );
  } else {
    svm.call(
      program,
      [slot[1], wrapperMint, slot[3], trader[0], source, recipient, trader[4]],
      saberDecimalsWrapperData(amountIn, true),
    );
  }
}

// The Saber decimal wrapper's `deposit` of the underlying token (`aToB`) or `withdraw` of the wrapped
// one, exactly `amountIn`. It carries no least out.
export function saberDecimalsWrapperData(amountIn: Uint256, aToB: bool): bytes {
  const deposit = hex`f223c68952e1f2b6`;
  const withdraw = hex`b712469c946da122`;
  const amount = amountIn & 0xffffffffffffffff;
  const ix = aToB ? deposit : withdraw;
  return ix.concat(amount.toBytesLe(8));
}

// Skips a withdrawal the vault cannot pay at the wrapper's rate: `amountIn ÷ multiplier` underlying
// units, nothing or past the vault's balance.
export function saberDecimalsWrapper(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const wrapper = slot[1];
  if (wrapper.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xbbeef1254d2fff3d6dcc6ebd8b771b84bd4a8f5146dd33b630481434a66592ae;
  require(wrapper.owner == id, "not a Saber decimal wrapper");
  if (trader[2] == slot[2]) {
    const underlying = amountIn / svm.sload(wrapper, 9, 8).toLe();
    if (underlying == 0 || underlying > svm.sload(slot[3], 64, 8).toLe()) {
      return 0;
    }
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapSaberDecimalsWrapper(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the wrapper, its mint, the underlying vault, the authority, the underlying and the
// wrapped token account, and SPL Token. It deposits the underlying token when `aToB`, and withdraws
// the wrapped one otherwise; it carries no least out, so it takes no `minOut`.
export function saberDecimalsWrapperCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xbbeef1254d2fff3d6dcc6ebd8b771b84bd4a8f5146dd33b630481434a66592ae, "not a Saber decimal wrapper");
  const deposit = hex`f223c68952e1f2b6`;
  const withdraw = hex`b712469c946da122`;
  const amount = amountIn & 0xffffffffffffffff;
  const ix = aToB ? deposit : withdraw;
  const data = ix.concat(amount.toBytesLe(8));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Stabble's stable and weighted swaps share one `swap` and one vault program. The slot is
// `[program, pool, withdrawAuthority, vault, vaultAuthority, vaultProgram, vaultTokenA,
// vaultTokenB, beneficiaryTokenA, beneficiaryTokenB]`: the vault's token accounts for the two
// tokens traded, then the vault beneficiary's for each; which is paid is read from A's mint. Classic
// SPL tokens only. The program id is the caller's to have checked.
function swapStabble(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const vaultTokenA = slot[6];
  const vaultTokenB = slot[7];
  const paysA = svm.sload(vaultTokenA, 0, 32).toBe() == trader[2].address;
  // `swap(amount_in: Option<u64>, minimum_amount_out: u64)`, the amount `Some`.
  svm.call(
    slot[0],
    [
      trader[0],
      trader[1],
      recipient,
      paysA ? vaultTokenA : vaultTokenB,
      paysA ? vaultTokenB : vaultTokenA,
      paysA ? slot[9] : slot[8],
      slot[1],
      slot[2],
      slot[3],
      slot[4],
      slot[5],
      trader[4],
    ],
    stabbleStableSwapData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// An inactive Stabble pool, or an empty side of its vault: true to skip.
function stabbleSkips(slot: Account[], trader: Account[]): bool {
  const paysA = svm.sload(slot[6], 0, 32).toBe() == trader[2].address;
  return (
    svm.sload(slot[1], 105, 1).toLe() == 0 ||
    svm.sload(paysA ? slot[7] : slot[6], 64, 8).toLe() == 0
  );
}

// Stabble's stable swap, swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ.
// Stabble's stable swap's `swap`, its amount `Some`: exact input of `amountIn`, `minOut` its least out.
export function stabbleStableSwapData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c801`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an inactive pool and an empty side.
export function stabbleStableSwap(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x0d0cc1f8ef8deeaf90449e237f383c976e36bd53652d3679e0118d158b731e42;
  require(pool.owner == id && slot[0].address == id, "not a Stabble stable pool");
  if (stabbleSkips(slot, trader)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapStabble(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the paying and receiving token accounts, the vault's input and output
// token accounts, the beneficiary's output token account, the pool, its withdraw authority, the
// vault, its authority, the vault program, and SPL Token.
export function stabbleStableSwapCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x0d0cc1f8ef8deeaf90449e237f383c976e36bd53652d3679e0118d158b731e42, "not a Stabble stable pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c801`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Stabble's weighted swap, swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW.
// Stabble's weighted swap's `swap`, its amount `Some`: exact input of `amountIn`, `minOut` its least out.
export function stabbleWeightedSwapData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c801`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an inactive pool and an empty side.
export function stabbleWeightedSwap(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x0d0cc1f637510d78a412fc17cf986f99cec3e78884317596d2a84c14e2565535;
  require(pool.owner == id && slot[0].address == id, "not a Stabble weighted pool");
  if (stabbleSkips(slot, trader)) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapStabble(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the paying and receiving token accounts, the vault's input and output
// token accounts, the beneficiary's output token account, the pool, its withdraw authority, the
// vault, its authority, the vault program, and SPL Token.
export function stabbleWeightedSwapCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x0d0cc1f637510d78a412fc17cf986f99cec3e78884317596d2a84c14e2565535, "not a Stabble weighted pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`f8c69e91e17587c801`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Mercurial, MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky: the stable swap's `exchange`, for a pool
// of two tokens. The slot is `[program, pool, authority, vault0, vault1]`; the program reads the
// direction from the paying and receiving accounts. Classic SPL tokens only.
function swapMercurial(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x052eca368763a5955f62734e40e772978388ec2bd8f50c6bf223f22d247b42ae, "not a Mercurial pool");
  svm.call(
    program,
    [slot[1], trader[4], slot[2], trader[0], slot[3], slot[4], trader[1], recipient],
    mercurialData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Mercurial's `exchange`: exact input of `amountIn`, `minOut` its least out.
export function mercurialData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`04`;
  return ix.concat(word.toBytesLe(16));
}

// Skips an empty side.
export function mercurial(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x052eca368763a5955f62734e40e772978388ec2bd8f50c6bf223f22d247b42ae;
  require(pool.owner == id, "not a Mercurial pool");
  const paysA = svm.sload(slot[3], 0, 32).toBe() == trader[2].address;
  if (svm.sload(paysA ? slot[4] : slot[3], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapMercurial(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, SPL Token, its authority, the authority, every vault of the pool in its
// order, and the paying and receiving token accounts: a pool of any number of tokens.
export function mercurialCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x052eca368763a5955f62734e40e772978388ec2bd8f50c6bf223f22d247b42ae, "not a Mercurial pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const ix = hex`04`;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Perena (Numéraire), NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P: `swap_exact_in` between two of a
// pool's tokens, each named by its index in the pool. The slot is `[program, pool, numeraireConfig,
// vaultA, vaultB]`: the pool's vaults for the two tokens traded, in either order; which is paid is
// read from A's mint. The function finds each mint's index among the pool's ten. The swap writes
// both mints, so they are attached writable.
function swapPerena(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x05801ed257838bcbfb687748ae4de2f6a5cafcadc61213bce4fe46b028ee8a82, "not a Perena pool");
  const pool = slot[1];
  const vaultA = slot[3];
  const vaultB = slot[4];
  const payMint = trader[2];
  const buyMint = trader[3];
  const paysA = svm.sload(vaultA, 0, 32).toBe() == payMint.address;
  svm.call(
    program,
    [
      pool,
      payMint,
      buyMint,
      trader[1],
      recipient,
      paysA ? vaultA : vaultB,
      paysA ? vaultB : vaultA,
      slot[2],
      trader[0],
      trader[4],
      trader[5],
    ],
    perenaData(
      amountIn,
      perenaIndex(pool, payMint.address),
      perenaIndex(pool, buyMint.address),
      minOut == 0 ? 1 : minOut,
    ),
  );
}

// The index of `mint` among a Perena pool's ten tokens (each pair's mint, 368 bytes apart from 296),
// or a revert when the pool does not hold it.
function perenaIndex(pool: Account, mint: Uint256): Uint256 {
  for (let i = 0; i < 10; i = i + 1) {
    if (svm.sload(pool, 296 + i * 368, 32).toBe() == mint) {
      return i;
    }
  }
  throw "pool is not the pair";
}

// Perena's `swap_exact_in`: `amountIn` of the pool's token `inIndex` for token `outIndex`, `minOut` its
// least out.
export function perenaData(
  amountIn: Uint256,
  inIndex: Uint256,
  outIndex: Uint256,
  minOut: Uint256,
): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require((inIndex | outIndex) <= 255, "index past its byte");
  const word = inIndex | (outIndex << 8) | ((amountIn & 0xffffffffffffffff) << 16) | (minOut << 80);
  const ix = hex`68688356a1bdb4d8`;
  return ix.concat(word.toBytesLe(18));
}

// Skips a paused pool (its status odd) and an empty side.
export function perena(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x05801ed257838bcbfb687748ae4de2f6a5cafcadc61213bce4fe46b028ee8a82;
  require(pool.owner == id, "not a Perena pool");
  const paysA = svm.sload(slot[3], 0, 32).toBe() == trader[2].address;
  if (
    (svm.sload(pool, 3880, 4).toLe() & 1) != 0 ||
    svm.sload(paysA ? slot[4] : slot[3], 64, 8).toLe() == 0
  ) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapPerena(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool, the input and output mint, the paying and receiving token accounts, the
// input and output vault, the Numéraire config, the authority, SPL Token, and Token-2022.
export function perenaCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  inIndex: Uint256,
  outIndex: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x05801ed257838bcbfb687748ae4de2f6a5cafcadc61213bce4fe46b028ee8a82, "not a Perena pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require((inIndex | outIndex) <= 255, "index past its byte");
  const word = inIndex | (outIndex << 8) | ((amountIn & 0xffffffffffffffff) << 16) | (minOut << 80);
  const ix = hex`68688356a1bdb4d8`;
  const data = ix.concat(word.toBytesLe(18));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// MetaDAO's futarchy AMM, FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq: `spot_swap`, a buy paying the
// quote token and a sell paying the base token. The slot is `[program, dao, baseVault, quoteVault,
// eventAuthority]`; which side is paid is read from the base vault's mint. Classic SPL tokens only.
function swapMetadaoFutarchy(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xd70be175ef5ac89c4f0ceee604aee598125b22df4aca2b9105c567e336126678, "not a MetaDAO futarchy pool");
  const source = trader[1];
  const sell = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  svm.call(
    program,
    [
      slot[1],
      sell ? source : recipient,
      sell ? recipient : source,
      slot[2],
      slot[3],
      trader[0],
      trader[4],
      slot[4],
      program,
    ],
    metadaoFutarchyData(amountIn, minOut == 0 ? 1 : minOut, sell),
  );
}

// MetaDAO futarchy's `spot_swap`: `SpotSwapParams` of `amountIn`, a sell of the base token when
// `paysBase` (a buy otherwise), and `minOut` its least out.
export function metadaoFutarchyData(amountIn: Uint256, minOut: Uint256, paysBase: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | ((paysBase ? 1 : 0) << 64) | (minOut << 72);
  const ix = hex`a7610ce7ed4ea6fb`;
  return ix.concat(word.toBytesLe(17));
}

// Skips a DAO not in its spot state (a conditional market runs another routine) and an empty side.
export function metadaoFutarchy(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0xd70be175ef5ac89c4f0ceee604aee598125b22df4aca2b9105c567e336126678;
  require(pool.owner == id, "not a MetaDAO futarchy pool");
  const sell = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  if (svm.sload(pool, 8, 1).toLe() != 0 || svm.sload(sell ? slot[3] : slot[2], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapMetadaoFutarchy(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the DAO, the base and quote token accounts (the paying one among them), the base and
// quote vault, the authority, SPL Token, the event authority, and the program. It sells the base
// token when `paysBase`.
export function metadaoFutarchyCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0xd70be175ef5ac89c4f0ceee604aee598125b22df4aca2b9105c567e336126678, "not a MetaDAO futarchy pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | ((paysBase ? 1 : 0) << 64) | (minOut << 72);
  const ix = hex`a7610ce7ed4ea6fb`;
  const data = ix.concat(word.toBytesLe(17));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Scale AMM's `buy`, paying token A (`aToB`), or `sell`: exact input of `amountIn`, `minOut` its
// least out.
export function scaleAmmData(amountIn: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const buy = hex`66063d1201daebea`;
  const sell = hex`33e685a4017f83ad`;
  const ix = aToB ? buy : sell;
  return ix.concat(word.toBytesLe(16));
}

// Scale AMM, SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA: `buy` paying token A, `sell` paying token
// B. Its swap takes one account per fee beneficiary, past what a function can list for some pools,
// so it has only its `Cpi` form. `accounts`: the pool, the authority (writable), the pool's owner,
// mints A and B, the authority's A and B token accounts (the paying one among them), vaults A and B,
// the platform's A fee account, A's and B's token program, the System program, the platform config,
// and each fee beneficiary's token account. It buys, paying token A, when `aToB`.
export function scaleAmmCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x067423cfab837b6d14341da33637866e9980bc5a139a8ffa1198f31b7cb60daf, "not a Scale AMM pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const buy = hex`66063d1201daebea`;
  const sell = hex`33e685a4017f83ad`;
  const ix = aToB ? buy : sell;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// PumpSwap's `sell` of `amountIn` of the base token (`paysBase`), or its `buy_exact_quote_in` of
// `amountIn` of the quote token, tracking no volume; `minOut` its least out.
export function pumpswapData(amountIn: Uint256, minOut: Uint256, paysBase: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const sell = hex`33e685a4017f83ad`;
  const buy = hex`c62e1552b4d9e870`;
  const none = hex`00`;
  return paysBase ? sell.concat(word.toBytesLe(16)) : buy.concat(word.toBytesLe(16), none);
}

// PumpSwap, pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: `sell` paying the base token, and
// `buy_exact_quote_in` paying the quote token, which spends exactly `amountIn`, fees included, and
// tracks no volume. Its swap takes more accounts than a function can list, so it has only its `Cpi`
// form. `accounts`: the pool, the authority, the global config, the base and quote mint, the base and
// quote token accounts (the paying one among them), the base and quote vault, the protocol fee
// recipient and its quote token account, the base and quote token program, the System program, the
// Associated Token program, the event authority, the program, the coin creator's vault token account
// and vault authority, then a buy's global and the authority's volume accumulators, then the fee
// config, the fee program, the pool's v2 account if the pool has a coin creator, and the buyback fee
// recipient and its quote token account. It sells the base token when `paysBase`.
export function pumpswapCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0x0c14defc825ec67694250818bb654065f4298d3156d571b4d4f8090c18e9a863, "not a PumpSwap pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const sell = hex`33e685a4017f83ad`;
  const buy = hex`c62e1552b4d9e870`;
  const none = hex`00`;
  const data = paysBase ? sell.concat(word.toBytesLe(16)) : buy.concat(word.toBytesLe(16), none);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Bonkswap's `swap` of `amountIn`, selling X when `xToY`, with no price limit. It carries no least
// out.
export function bonkswapData(amountIn: Uint256, xToY: bool): bytes {
  const amount = amountIn & 0xffffffffffffffff;
  const swap = hex`f8c69e91e17587c8`;
  // A price limit the swap never reaches: 0 selling X, the price only falling; u128's most buying it.
  const sellX = hex`0000000000000000000000000000000001`;
  const buyX = hex`ffffffffffffffffffffffffffffffff00`;
  return swap.concat(amount.toBytesLe(8), xToY ? sellX : buyX);
}

// Bonkswap, BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p: `swap`, with no price limit and no floor of its own (`minOut`
// has nothing to ride in). Its swap takes more accounts than a function can list, so it has only
// its `Cpi` form. `accounts`: the program state, the pool, mints X and Y, the pool's X and Y token
// accounts, the authority's X and Y token accounts (the paying one among them), the authority, the
// same three again as the referrer, the program authority, the System program, SPL Token, the
// Associated Token program, and the rent sysvar. It sells X when `xToY`; it carries no least out, so
// it takes no `minOut`.
export function bonkswapCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  xToY: bool,
): Uint256 {
  require(program.address ==
    0x9b3a5d9985cd63dcc86291b48e4346d69dab3663f231f0c75f6fc48476ec6f7d, "not a Bonkswap pool");
  const amount = amountIn & 0xffffffffffffffff;
  const swap = hex`f8c69e91e17587c8`;
  // A price limit the swap never reaches: 0 selling X, the price only falling; u128's most buying it.
  const sellX = hex`0000000000000000000000000000000001`;
  const buyX = hex`ffffffffffffffffffffffffffffffff00`;
  const data = swap.concat(amount.toBytesLe(8), xToY ? sellX : buyX);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Guacswap's `swap` of `amountIn`, selling X when `xToY`, with no price limit. It carries no least
// out.
export function guacswapData(amountIn: Uint256, xToY: bool): bytes {
  const amount = amountIn & 0xffffffffffffffff;
  const swap = hex`f8c69e91e17587c8`;
  // A price limit the swap never reaches: 0 selling X, the price only falling; u128's most buying it.
  const sellX = hex`0000000000000000000000000000000001`;
  const buyX = hex`ffffffffffffffffffffffffffffffff00`;
  return swap.concat(amount.toBytesLe(8), xToY ? sellX : buyX);
}

// Guacswap, Gswppe6ERWKpUTXvRPfXdzHhiCyJvLadVvXGfdpBqcE1: Bonkswap's code, its `Cpi` form the same.
export function guacswapCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  xToY: bool,
): Uint256 {
  require(program.address ==
    0xebec55a9658af046dd5a604cb3c42cbcf70fbe58a18fc21ee06494b43d30305e, "not a Guacswap pool");
  const amount = amountIn & 0xffffffffffffffff;
  const swap = hex`f8c69e91e17587c8`;
  // A price limit the swap never reaches: 0 selling X, the price only falling; u128's most buying it.
  const sellX = hex`0000000000000000000000000000000001`;
  const buyX = hex`ffffffffffffffffffffffffffffffff00`;
  const data = swap.concat(amount.toBytesLe(8), xToY ? sellX : buyX);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Meteora DLMM, LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: `swap` of exactly `amountIn`, held to
// the venue's own floor, `minOut`, with no price limit: the swap crosses the bins it needs. `slot`:
// the program, the pool, its program's event authority, its X and Y reserves (the pool's own order,
// not the keys'), its oracle, and the bin arrays its bitmap marks from the active bin's in the
// trade's direction, the System program past the last. Its swap takes the first two (`swap`, for two
// SPL Token mints) or the first alone (`swap2`, for a Token-2022 mint): an input past what they
// hold fails the swap. Returns 0 having moved nothing for a missing slot, no input, a pool whose swaps
// are off and one not active yet.
export function meteoraDlmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const id = 0x04e9e12fbc84e826c932cce9e2640cce15590c1c6273b0925708ba3b8520b0bc;
  require(pool.owner == id && slot[0].address == id, "not a Meteora DLMM pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // Paying token X, the pool's first (not key order): a pair the pool does not hold the venue
  // refuses.
  const paysX = svm.sload(pool, 88, 32).toBe() == trader[2].address;
  // Swaps off (its status), or not active yet: its activation point, a slot or a time by its type.
  const point = svm.sload(pool, 816, 8).toLe();
  if (
    svm.sload(pool, 82, 1).toLe() != 0 ||
    (point != 0 &&
      (svm.sload(pool, 86, 1).toLe() == 0 ? ctx.blockNumber() : ctx.timestamp()) < point)
  ) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  cpiDlmm(slot, trader, paysX, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// Meteora DLMM's swap of `amount`, `minOut` its least out, from a slot: the pool, its bitmap
// extension (the program, for none), its X and Y reserves, the paying and receiving accounts, mints X
// and Y, the oracle, the host fee account (the program, for none), the authority, X's and Y's token
// programs, then the event authority, the program and the slot's first two bin arrays (a System
// program among them is passed over) for `swap`; for `swap2`, which takes Token-2022 too, the memo
// program before them, no transfer-hook accounts, and the first bin array alone. Seventeen accounts,
// filled in place: more than a function holds at once.
function cpiDlmm(
  slot: Account[],
  trader: Account[],
  paysX: bool,
  amount: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const mintX = paysX ? trader[2] : trader[3];
  const mintY = paysX ? trader[3] : trader[2];
  const token = trader[4].address;
  const swap2 = mintX.owner != token || mintY.owner != token;
  const p = slot[0];
  const accounts = [p, p, p, p, p, p, p, p, p, p, p, p, p, p, p, p, p];
  accounts[0] = slot[1];
  accounts[2] = slot[3];
  accounts[3] = slot[4];
  accounts[4] = trader[1];
  accounts[5] = recipient;
  accounts[6] = mintX;
  accounts[7] = mintY;
  accounts[8] = slot[5];
  accounts[10] = trader[0];
  accounts[11] = mintX.owner == token ? trader[4] : trader[5];
  accounts[12] = mintY.owner == token ? trader[4] : trader[5];
  accounts[13] = swap2 ? trader[6] : slot[2];
  accounts[14] = swap2 ? slot[2] : slot[0];
  accounts[15] = swap2 ? slot[0] : slot[6];
  accounts[16] = swap2 ? slot[6] : slot[7];
  // `swap2`'s data ends with the transfer-hook accounts' count, 0.
  const swap = swap2 ? hex`414b3f4ceb5b5b88` : hex`f8c69e91e17587c8`;
  const word = (amount & 0xffffffffffffffff) | (minOut << 64);
  svm.call(slot[0], accounts, swap.concat(word.toBytesLe(swap2 ? 20 : 16)));
}

// Meteora DLMM's `swap`: exact input of `amountIn`, `minOut` its least out. The direction is the
// accounts'.
export function meteoraDlmmData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(16));
}

// Meteora DLMM, LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: `swap`, exact input held to the
// venue's own floor, with no price limit: the swap crosses the bins it needs, up to the end of the
// bin arrays it is given, as many as the caller lists (`meteoraDlmm`, above, takes a slot's two).
// `accounts`: the pool, its bin-array bitmap extension (the program itself when the pool has
// none), its X and Y reserves, the authority's paying and receiving token accounts, mints X and Y,
// the oracle, the host fee account (the program itself for none), the authority, X's and Y's token
// programs, the event authority, the program, then the bin arrays the swap crosses, from the active
// bin onwards in the trade's direction. The venue reads the direction from the paying account's mint.
export function meteoraDlmmCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x04e9e12fbc84e826c932cce9e2640cce15590c1c6273b0925708ba3b8520b0bc, "not a Meteora DLMM pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Saros DLMM's `swap`: exact input of `amountIn`, `minOut` its least out, selling X when `xToY`.
export function sarosDlmmData(amountIn: Uint256, minOut: Uint256, xToY: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then `swap_for_y` and the swap type, 0 for exact input.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((xToY ? 1 : 0) << 128);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(18));
}

// Saros DLMM, 1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE: `swap`, exact input held to the venue's own
// floor, with no price limit: the swap crosses the bins its two bin arrays hold. It takes more
// accounts than a function can list, so it has only its `Cpi` form. `accounts`: the pair, mints X
// and Y, the lower and upper bin arrays around the active bin, the pair's X and Y vaults, the
// authority's X and Y token accounts (the paying one among them), the authority, X's and Y's token
// programs, the Memo program, the pair's hook and the hook's program (the program itself, twice, for
// a pair with no hook), the event authority, and the program. It sells X when `xToY`.
export function sarosDlmmCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  xToY: bool,
): Uint256 {
  require(program.address ==
    0x0036f3862b0757e15b27242268fadf5d7523728765d25547944ad67e56555b51, "not a Saros DLMM pair");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then `swap_for_y` and the swap type, 0 for exact input.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((xToY ? 1 : 0) << 128);
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(word.toBytesLe(18));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Proprietary and oracle-priced venues. Each prices off its market maker's own oracle or quote, which a
// keeper keeps fresh, and refuses a swap on a quote gone stale: a swap cannot see that before it
// runs, so a stale quote fails the transaction.

// SolFi v2, SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF: `swap`, priced off its oracle and the
// program's
// registry. The slot is `[program, pool, oracle, registry, vaultA, vaultB, instructionsSysvar]`.
// The
// swap writes the authority, so it has to be attached writable.
function swapSolfiV2(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x06873437b4fbc9f40437dd3ce63f9cfe8c2484035593a12781ba2a97be341696, "not a SolFi v2 pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = svm.sload(slot[4], 0, 32).toBe() == payMint.address;
  const mintA = paysA ? payMint : buyMint;
  const mintB = paysA ? buyMint : payMint;
  svm.call(
    program,
    [
      trader[0],
      slot[1],
      slot[2],
      slot[3],
      slot[4],
      slot[5],
      paysA ? trader[1] : recipient,
      paysA ? recipient : trader[1],
      mintA,
      mintB,
      mintA.owner == token2022.address ? token2022 : tokenProgram,
      mintB.owner == token2022.address ? token2022 : tokenProgram,
      slot[6],
    ],
    solfiV2Data(amountIn, minOut == 0 ? 1 : minOut, paysA),
  );
}

// SolFi v2's `swap`: exact input of `amountIn`, `minOut` its least out, paying token A when `aToB`.
export function solfiV2Data(amountIn: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then the direction: 0 pays token A.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((aToB ? 0 : 1) << 128);
  const ix = hex`07`;
  return ix.concat(word.toBytesLe(17));
}

// Skips an empty side.
export function solfiV2(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0x06873437b4fbc9f40437dd3ce63f9cfe8c2484035593a12781ba2a97be341696, "not a SolFi v2 pool");
  const paysA = svm.sload(slot[4], 0, 32).toBe() == trader[2].address;
  if (svm.sload(paysA ? slot[5] : slot[4], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapSolfiV2(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority (writable), the pool, its oracle, the program's registry, its A and
// B vaults, the authority's A and B token accounts (the paying one among them), mints A and B,
// their token programs, and the Instructions sysvar. It pays A when `aToB`.
export function solfiV2Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x06873437b4fbc9f40437dd3ce63f9cfe8c2484035593a12781ba2a97be341696, "not a SolFi v2 pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then the direction: 0 pays token A.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((aToB ? 0 : 1) << 128);
  const ix = hex`07`;
  const data = ix.concat(word.toBytesLe(17));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Hadron, HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8: `swap`. The slot is `[program, pool,
// assetConfigA, assetConfigB, growingA, vaultA, vaultB, globalConfig, feeVaultA, feeVaultB, clock,
// metadataA]`, the fee vaults being the fee treasury's token accounts for A and B (the swap pays
// its
// fee into the paid token's) and `clock` the Clock sysvar. Its swap takes SPL Token for both
// tokens.
function swapHadron(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xf017451f68c728954ad10c442fc0a04a2b56c57fe52a96c8221a0c61c0e8727d, "not a Hadron pool");
  const payMint = trader[2];
  const tokenProgram = trader[4];
  const paysA = svm.sload(slot[5], 0, 32).toBe() == payMint.address;
  svm.call(
    program,
    [
      tokenProgram,
      tokenProgram,
      slot[1],
      slot[2],
      slot[3],
      slot[4],
      slot[1],
      trader[0],
      trader[1],
      paysA ? slot[5] : slot[6],
      paysA ? slot[6] : slot[5],
      recipient,
      slot[7],
      paysA ? slot[8] : slot[9],
      slot[10],
      slot[11],
    ],
    hadronData(amountIn, minOut, paysA),
  );
}

// Hadron's `swap`: exact input of `amountIn`, `minOut` its least out, paying token A when `aToB`.
export function hadronData(amountIn: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The direction (1 pays token A), the amount, the floor, then a deadline that never passes.
  const word =
    (aToB ? 1 : 0) |
    ((amountIn & 0xffffffffffffffff) << 8) |
    (minOut << 72) |
    (0x7fffffffffffffff << 136);
  const ix = hex`03`;
  return ix.concat(word.toBytesLe(25));
}

// Skips an empty side.
export function hadron(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0xf017451f68c728954ad10c442fc0a04a2b56c57fe52a96c8221a0c61c0e8727d, "not a Hadron pool");
  const paysA = svm.sload(slot[5], 0, 32).toBe() == trader[2].address;
  if (svm.sload(paysA ? slot[6] : slot[5], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapHadron(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: SPL Token twice, the pool, its A and B asset configs, its growing account, the
// pool again, the authority, the authority's paying token account, the pool's paying and paid
// vaults, the authority's receiving token account, the global config, the fee vault for the paid
// token, the Clock sysvar, and the pool's A metadata. It pays A when `aToB`.
export function hadronCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xf017451f68c728954ad10c442fc0a04a2b56c57fe52a96c8221a0c61c0e8727d, "not a Hadron pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The direction (1 pays token A), the amount, the floor, then a deadline that never passes.
  const word =
    (aToB ? 1 : 0) |
    ((amountIn & 0xffffffffffffffff) << 8) |
    (minOut << 72) |
    (0x7fffffffffffffff << 136);
  const ix = hex`03`;
  const data = ix.concat(word.toBytesLe(25));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// TaurusFi, 9VX8EKBg6vM6tA68xaDsPkbrx26XConZjkQmhVApUptc: `swap`, priced off its price account,
// which
// is the pool. The slot is `[program, price, vault0, vault1, vaultAuthority, globalConfig,
// globalAuthority, instructionsSysvar]`. Its swap has no floor of its own and writes the authority,
// so it has to be attached writable. It refuses a swap once the price account's slot window has
// passed.
function swapTaurusfi(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x7e2bd1f2dfc2858aaf5b54d049c0254a20cf4fd320baf46601c3c1f308603115, "not a TaurusFi pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const pays0 = svm.sload(slot[2], 0, 32).toBe() == payMint.address;
  svm.call(
    program,
    [
      slot[2],
      slot[3],
      trader[0],
      pays0 ? trader[1] : recipient,
      pays0 ? recipient : trader[1],
      slot[4],
      slot[5],
      slot[1],
      slot[6],
      payMint.owner == token2022.address ? token2022 : tokenProgram,
      buyMint.owner == token2022.address ? token2022 : tokenProgram,
      payMint,
      buyMint,
      slot[7],
    ],
    taurusfiData(amountIn),
  );
}

// TaurusFi's `swap`: exact input of `amountIn`. It carries no least out; the direction is the
// accounts'.
export function taurusfiData(amountIn: Uint256): bytes {
  // The amount, then two fixed bytes: the swap reads its direction from the accounts.
  const word = (amountIn & 0xffffffffffffffff) | (1 << 72);
  const ix = hex`08`;
  return ix.concat(word.toBytesLe(10));
}

// Skips an empty side.
export function taurusfi(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0x7e2bd1f2dfc2858aaf5b54d049c0254a20cf4fd320baf46601c3c1f308603115, "not a TaurusFi pool");
  const pays0 = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  if (svm.sload(pays0 ? slot[3] : slot[2], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTaurusfi(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool's token 0 and token 1 vaults, the authority (writable), the authority's
// token 0 and token 1 accounts (the paying one among them), the vault authority, the global
// config, the price account, the global authority, the paid and bought tokens' programs, the
// paid and bought mints, and the Instructions sysvar.
export function taurusfiCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
): Uint256 {
  require(program.address ==
    0x7e2bd1f2dfc2858aaf5b54d049c0254a20cf4fd320baf46601c3c1f308603115, "not a TaurusFi pool");
  // The amount, then two fixed bytes: the swap reads its direction from the accounts.
  const word = (amountIn & 0xffffffffffffffff) | (1 << 72);
  const ix = hex`08`;
  const data = ix.concat(word.toBytesLe(10));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Riptide, riptK81hDxhe5pW5jSzSM9iRA8azgEgLJ4dXkPtBS7j: `swap`. The slot is `[program, pool,
// vaultA,
// vaultB, instructionsSysvar, dontFront]`, `dontFront` being
// `jitodontfront111111111111111111111111111111`, which the swap requires. Its swap has no floor of
// its own.
function swapRiptide(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x0cbcc08307b47ca54d6b52f31d59682d7ba7f1bdbc905d762b0ff05df2bc4b4a, "not a Riptide pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = svm.sload(slot[2], 0, 32).toBe() == payMint.address;
  const mintA = paysA ? payMint : buyMint;
  const mintB = paysA ? buyMint : payMint;
  svm.call(
    program,
    [
      trader[0],
      slot[1],
      mintA,
      mintB,
      paysA ? trader[1] : recipient,
      paysA ? recipient : trader[1],
      slot[2],
      slot[3],
      mintA.owner == token2022.address ? token2022 : tokenProgram,
      mintB.owner == token2022.address ? token2022 : tokenProgram,
      trader[6],
      slot[4],
      slot[5],
    ],
    riptideData(amountIn, paysA),
  );
}

// Riptide's `swap`: exact input of `amountIn`, paying token A when `aToB`. It carries no least out.
export function riptideData(amountIn: Uint256, aToB: bool): bytes {
  // The amount, the direction (1 pays token A), then two fixed bytes.
  const word = (amountIn & 0xffffffffffffffff) | ((aToB ? 1 : 0) << 64) | (1 << 80);
  const ix = hex`02`;
  return ix.concat(word.toBytesLe(11));
}

// Skips an empty side.
export function riptide(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0x0cbcc08307b47ca54d6b52f31d59682d7ba7f1bdbc905d762b0ff05df2bc4b4a, "not a Riptide pool");
  const paysA = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  if (svm.sload(paysA ? slot[3] : slot[2], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapRiptide(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the pool, mints A and B, the authority's A and B token accounts
// (the paying one among them), the pool's A and B vaults, their token programs, the Memo
// program, the Instructions sysvar, and `jitodontfront111111111111111111111111111111`. It pays A
// when `aToB`.
export function riptideCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x0cbcc08307b47ca54d6b52f31d59682d7ba7f1bdbc905d762b0ff05df2bc4b4a, "not a Riptide pool");
  // The amount, the direction (1 pays token A), then two fixed bytes.
  const word = (amountIn & 0xffffffffffffffff) | ((aToB ? 1 : 0) << 64) | (1 << 80);
  const ix = hex`02`;
  const data = ix.concat(word.toBytesLe(11));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Denali, DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4: `swap`, priced off its oracle. The slot is
// `[program, pool, vaultA, vaultB, oracle, globalConfig]`.
function swapDenali(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xb7c2f0db335735cbd89036f3678822a6f71b6b9fd244cef6245abcd89b0a848f, "not a Denali pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = svm.sload(slot[2], 0, 32).toBe() == payMint.address;
  const mintA = paysA ? payMint : buyMint;
  const mintB = paysA ? buyMint : payMint;
  svm.call(
    program,
    [
      trader[0],
      slot[1],
      mintA,
      mintB,
      slot[2],
      slot[3],
      mintA.owner == token2022.address ? token2022 : tokenProgram,
      mintB.owner == token2022.address ? token2022 : tokenProgram,
      slot[4],
      slot[5],
      paysA ? trader[1] : recipient,
      paysA ? recipient : trader[1],
    ],
    denaliData(amountIn, minOut, paysA),
  );
}

// Denali's `swap`: exact input of `amountIn`, `minOut` its least out, paying token A when `aToB`.
export function denaliData(amountIn: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The direction (0 pays token A), the amount, the floor.
  const word = (aToB ? 0 : 1) | ((amountIn & 0xffffffffffffffff) << 8) | (minOut << 72);
  const ix = hex`68688356a1bdb4d8`;
  return ix.concat(word.toBytesLe(17));
}

// Skips an empty side.
export function denali(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0xb7c2f0db335735cbd89036f3678822a6f71b6b9fd244cef6245abcd89b0a848f, "not a Denali pool");
  const paysA = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  if (svm.sload(paysA ? slot[3] : slot[2], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapDenali(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the pool, mints A and B, the pool's A and B vaults, their token
// programs, the oracle, the global config, and the authority's A and B token accounts (the
// paying one among them). It pays A when `aToB`.
export function denaliCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xb7c2f0db335735cbd89036f3678822a6f71b6b9fd244cef6245abcd89b0a848f, "not a Denali pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The direction (0 pays token A), the amount, the floor.
  const word = (aToB ? 0 : 1) | ((amountIn & 0xffffffffffffffff) << 8) | (minOut << 72);
  const ix = hex`68688356a1bdb4d8`;
  const data = ix.concat(word.toBytesLe(17));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Gavel, srAMMzfVHVAtgSJc8iH6CfKzuWuUTzLHVCE81QU1rgi: the sr-AMM's `swap`. The slot is
// `[program, pool,
// logAuthority, baseVault, quoteVault]`. Its swap takes SPL Token for both tokens.
function swapGavel(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x0d06a0920ae43425bbcbc1e38e455bffe287f632ddefb1c1ecbecbf35f71f373, "not a Gavel pool");
  const payMint = trader[2];
  const tokenProgram = trader[4];
  const sellsBase = svm.sload(slot[3], 0, 32).toBe() == payMint.address;
  svm.call(
    program,
    [
      program,
      slot[2],
      slot[1],
      trader[0],
      sellsBase ? trader[1] : recipient,
      sellsBase ? recipient : trader[1],
      slot[3],
      slot[4],
      tokenProgram,
    ],
    gavelData(amountIn, minOut == 0 ? 1 : minOut, sellsBase),
  );
}

// Gavel's `swap`: exact input of `amountIn`, `minOut` its least out, selling the base token when
// `paysBase`.
export function gavelData(amountIn: Uint256, minOut: Uint256, paysBase: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The instruction, the side (1 sells the base token), exact input, the amount, the floor.
  const word = ((paysBase ? 1 : 0) << 8) | ((amountIn & 0xffffffffffffffff) << 24) | (minOut << 88);
  return word.toBytesLe(19);
}

// Skips an empty side.
export function gavel(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0x0d06a0920ae43425bbcbc1e38e455bffe287f632ddefb1c1ecbecbf35f71f373, "not a Gavel pool");
  const sellsBase = svm.sload(slot[3], 0, 32).toBe() == trader[2].address;
  if (svm.sload(sellsBase ? slot[4] : slot[3], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapGavel(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the program itself, its log authority, the pool, the authority, the authority's
// base and quote token accounts (the paying one among them), the pool's base and quote vaults,
// and SPL Token. It sells the base token when `paysBase`.
export function gavelCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0x0d06a0920ae43425bbcbc1e38e455bffe287f632ddefb1c1ecbecbf35f71f373, "not a Gavel pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The instruction, the side (1 sells the base token), exact input, the amount, the floor.
  const word = ((paysBase ? 1 : 0) << 8) | ((amountIn & 0xffffffffffffffff) << 24) | (minOut << 88);
  const data = word.toBytesLe(19);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Tessera V, TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH: `swap`, selling token A only (the B-to-A
// swap's accounts are not verified). The slot is `[program, pool, authority, vaultA, vaultB,
// instructionsSysvar, config, oracle]`, `authority` being the program's own. It refuses a swap many
// slots after its quote was last stamped.
function swapTesserav(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x06d3edc4e573adaff3e573898b545b1ee8d28d058ed94e88e0bcb332571bea0a, "not a Tessera V pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  require(svm.sload(slot[3], 0, 32).toBe() == payMint.address, "Tessera V sells only token A");
  svm.call(
    program,
    [
      slot[2],
      slot[1],
      trader[0],
      slot[3],
      slot[4],
      trader[1],
      recipient,
      payMint,
      buyMint,
      payMint.owner == token2022.address ? token2022 : tokenProgram,
      buyMint.owner == token2022.address ? token2022 : tokenProgram,
      slot[5],
      slot[6],
      slot[7],
    ],
    tesseravData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Tessera V's `swap`: exact input of `amountIn` of token A, `minOut` its least out.
export function tesseravData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The direction (1 sells token A), the amount, the floor.
  const word = 1 | ((amountIn & 0xffffffffffffffff) << 8) | (minOut << 72);
  const ix = hex`10`;
  return ix.concat(word.toBytesLe(17));
}

// Skips an empty side.
export function tesserav(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0x06d3edc4e573adaff3e573898b545b1ee8d28d058ed94e88e0bcb332571bea0a, "not a Tessera V pool");
  if (svm.sload(slot[4], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTesserav(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the program's authority, the pool, the authority, the pool's A and B vaults, the
// authority's A and B token accounts (A paying), mints A and B, their token programs, the
// Instructions sysvar, the program's config and its oracle account.
export function tesseravCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x06d3edc4e573adaff3e573898b545b1ee8d28d058ed94e88e0bcb332571bea0a, "not a Tessera V pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The direction (1 sells token A), the amount, the floor.
  const word = 1 | ((amountIn & 0xffffffffffffffff) << 8) | (minOut << 72);
  const ix = hex`10`;
  const data = ix.concat(word.toBytesLe(17));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Flint, FLiNTXPwppyoJabCoxc2uiiRygAHpmMXajiDXo2Ub1z: `swap` between two of its markets, one per
// token.
// The slot is `[program, marketA, marketB, vaultA, vaultB, instructionsSysvar]`, each vault its
// market's. Its swap has no floor of its own; a pair it does not quote both ways refuses the other.
function swapFlint(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x03ac6bd3a59b41770ebf4c239e0266a3e41b9e64adac3a030eaccc6bad070b89, "not a Flint pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = svm.sload(slot[3], 0, 32).toBe() == payMint.address;
  svm.call(
    program,
    [
      trader[0],
      slot[5],
      paysA ? slot[1] : slot[2],
      paysA ? slot[2] : slot[1],
      trader[1],
      paysA ? slot[3] : slot[4],
      recipient,
      paysA ? slot[4] : slot[3],
      payMint.owner == token2022.address ? token2022 : tokenProgram,
      buyMint.owner == token2022.address ? token2022 : tokenProgram,
      program,
    ],
    flintData(amountIn),
  );
}

// Flint's `swap`: exact input of `amountIn`. It carries no least out; the direction is the
// accounts'.
export function flintData(amountIn: Uint256): bytes {
  // The amount, then two fixed bytes: the swap reads its direction from the accounts.
  const word = amountIn & 0xffffffffffffffff;
  const ix = hex`0b`;
  return ix.concat(word.toBytesLe(10));
}

// Skips an empty side.
export function flint(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0x03ac6bd3a59b41770ebf4c239e0266a3e41b9e64adac3a030eaccc6bad070b89, "not a Flint pool");
  const paysA = svm.sload(slot[3], 0, 32).toBe() == trader[2].address;
  if (svm.sload(paysA ? slot[4] : slot[3], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapFlint(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the Instructions sysvar, the paid and bought tokens' markets, the
// authority's paying token account, the paid market's vault, the authority's receiving token
// account, the bought market's vault, the paid and bought tokens' programs, and the program
// itself.
export function flintCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
): Uint256 {
  require(program.address ==
    0x03ac6bd3a59b41770ebf4c239e0266a3e41b9e64adac3a030eaccc6bad070b89, "not a Flint pool");
  // The amount, then two fixed bytes: the swap reads its direction from the accounts.
  const word = amountIn & 0xffffffffffffffff;
  const ix = hex`0b`;
  const data = ix.concat(word.toBytesLe(10));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Deriverse, DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD: a spot instrument's `swap`, a market order
// against its book. The slot is `[program, instrument, assetVault, crncyVault, bidsTree, bidOrders,
// asksTree, askOrders, lines, maps, clientInfos]`: selling the asset token takes the bids, buying it
// the asks. The swap requires the authority's associated token accounts, writes the authority, so it
// has to be attached writable, and takes SPL Token for both tokens.
function swapDeriverse(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xb89258789c952e0f14bdab2a705585135da2b43447b210b4754cd2c15d2110a0, "not a Deriverse pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const instrument = slot[1];
  const sells = svm.sload(instrument, 416, 32).toBe() == payMint.address;
  svm.call(
    program,
    [
      trader[0],
      sells ? payMint : buyMint,
      sells ? buyMint : payMint,
      slot[2],
      slot[3],
      instrument,
      sells ? slot[4] : slot[6],
      sells ? slot[5] : slot[7],
      slot[8],
      slot[9],
      slot[10],
      sells ? trader[1] : recipient,
      sells ? recipient : trader[1],
      trader[4],
    ],
    deriverseData(amountIn, svm.sload(instrument, 8, 4).toLe(), minOut == 0 ? 1 : minOut, sells),
  );
}

// Deriverse's spot `swap` on instrument `instrId`: exact input of `amountIn`, `minOut` its least out,
// selling the asset token when `paysBase`.
export function deriverseData(
  amountIn: Uint256,
  instrId: Uint256,
  minOut: Uint256,
  paysBase: bool,
): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(instrId <= 0xffffffff, "instrId past 32 bits");
  // The instruction, the side (1 buys the asset), the instrument, no price, the amount, the floor.
  const word =
    0x1a |
    ((paysBase ? 0 : 1) << 8) |
    (instrId << 32) |
    ((amountIn & 0xffffffffffffffff) << 128) |
    (minOut << 192);
  return word.toBytesLe(32);
}

// Skips an empty side.
export function deriverse(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0xb89258789c952e0f14bdab2a705585135da2b43447b210b4754cd2c15d2110a0, "not a Deriverse pool");
  const sells = svm.sload(pool, 416, 32).toBe() == trader[2].address;
  if (svm.sload(sells ? slot[3] : slot[2], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapDeriverse(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority (writable), the asset and currency mints, the instrument's asset and
// currency vaults, the instrument, the bids tree and orders (selling the asset) or the asks tree
// and orders (buying it), its lines, maps and client infos, the authority's asset and currency
// token accounts (the paying one among them), and SPL Token. It sells the asset when `paysBase`;
// `instrId` is the instrument's id.
export function deriverseCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  instrId: Uint256,
  minOut: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0xb89258789c952e0f14bdab2a705585135da2b43447b210b4754cd2c15d2110a0, "not a Deriverse pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require(instrId <= 0xffffffff, "instrId past 32 bits");
  // The instruction, the side (1 buys the asset), the instrument, no price, the amount, the floor.
  const word =
    0x1a |
    ((paysBase ? 0 : 1) << 8) |
    (instrId << 32) |
    ((amountIn & 0xffffffffffffffff) << 128) |
    (minOut << 192);
  const data = word.toBytesLe(32);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// GoonFi v2, goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE: `swap`, priced off its oracle. The slot is
// `[program, pool, vaultA, vaultB, oracle, globalConfig, instructionsSysvar, validator]`, `validator`
// being the vote account `J1to1yufRnoWn81KYg1XkTWzmKjnYSnmE2VY8DGUJ9Qv`, which the swap requires. The
// swap writes the authority, so it has to be attached writable.
function swapGoonfiV2(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x0a32937c463db0442e65a3b05e55b302ca5dc743f2c8df5673fd43ef744cf0af, "not a GoonFi v2 pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const paysA = svm.sload(slot[2], 0, 32).toBe() == payMint.address;
  const mintA = paysA ? payMint : buyMint;
  const mintB = paysA ? buyMint : payMint;
  svm.call(
    program,
    [
      trader[0],
      slot[1],
      paysA ? trader[1] : recipient,
      paysA ? recipient : trader[1],
      slot[2],
      slot[3],
      mintA,
      mintB,
      slot[4],
      slot[5],
      slot[6],
      mintA.owner == token2022.address ? token2022 : tokenProgram,
      mintB.owner == token2022.address ? token2022 : tokenProgram,
      slot[7],
    ],
    goonfiV2Data(amountIn, minOut == 0 ? 1 : minOut, paysA),
  );
}

// GoonFi v2's `swap`: exact input of `amountIn`, `minOut` its least out, paying token A when `aToB`.
export function goonfiV2Data(amountIn: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The instruction, the direction (1 pays token B), the amount, the floor, then a zero byte.
  const word = 1 | ((aToB ? 0 : 1) << 8) | ((amountIn & 0xffffffffffffffff) << 16) | (minOut << 80);
  return word.toBytesLe(19);
}

// Skips an empty side.
export function goonfiV2(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0x0a32937c463db0442e65a3b05e55b302ca5dc743f2c8df5673fd43ef744cf0af, "not a GoonFi v2 pool");
  const paysA = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  if (svm.sload(paysA ? slot[3] : slot[2], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapGoonfiV2(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority (writable), the pool, the authority's A and B token accounts (the
// paying one among them), the pool's A and B vaults, mints A and B, the oracle, the global
// config, the Instructions sysvar, A's and B's token programs, and the validator vote account.
// It pays A when `aToB`.
export function goonfiV2Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x0a32937c463db0442e65a3b05e55b302ca5dc743f2c8df5673fd43ef744cf0af, "not a GoonFi v2 pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The instruction, the direction (1 pays token B), the amount, the floor, then a zero byte.
  const word = 1 | ((aToB ? 0 : 1) << 8) | ((amountIn & 0xffffffffffffffff) << 16) | (minOut << 80);
  const data = word.toBytesLe(19);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Bonding curves and launchpads. Each sells a launched token against its quote token along the
// venue's own curve until the token graduates; a graduated, migrated or paused curve refuses the
// swap. A curve settled in native SOL on the authority (pump.fun's bonding curve, Boop, Moonit) is
// not here: a Pot holds no native SOL it can pay out.

// Meteora Dynamic Bonding Curve, dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: `swap`. The slot is
// `[program, pool, poolAuthority, config, baseVault, quoteVault, eventAuthority]`. The swap reads its
// direction from the paying account's mint.
function swapMeteoraDbc(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x09600ca524f7b1b7d6ccb1c3973aa0330d1903da601cc9b5dee3c662b4cad149, "not a Meteora DBC pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const sellsBase = svm.sload(slot[4], 0, 32).toBe() == payMint.address;
  const baseMint = sellsBase ? payMint : buyMint;
  const quoteMint = sellsBase ? buyMint : payMint;
  svm.call(
    program,
    [
      slot[2],
      slot[3],
      slot[1],
      trader[1],
      recipient,
      slot[4],
      slot[5],
      baseMint,
      quoteMint,
      trader[0],
      baseMint.owner == token2022.address ? token2022 : tokenProgram,
      quoteMint.owner == token2022.address ? token2022 : tokenProgram,
      program,
      slot[6],
      program,
    ],
    meteoraDbcData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Meteora DBC's `swap`: exact input of `amountIn`, `minOut` its least out. The direction is the
// accounts'.
export function meteoraDbcData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(16));
}

// Skips an empty side.
export function meteoraDbc(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0x09600ca524f7b1b7d6ccb1c3973aa0330d1903da601cc9b5dee3c662b4cad149 &&
    pool.owner ==
      0x09600ca524f7b1b7d6ccb1c3973aa0330d1903da601cc9b5dee3c662b4cad149, "not a Meteora DBC pool");
  const sellsBase = svm.sload(slot[4], 0, 32).toBe() == trader[2].address;
  if (svm.sload(sellsBase ? slot[5] : slot[4], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapMeteoraDbc(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the pool authority, the config, the pool, the authority's paying and receiving token
// accounts, the base and quote vaults, the base and quote mints, the authority, their token
// programs, the program itself (no referral), the event authority, and the program itself.
export function meteoraDbcCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x09600ca524f7b1b7d6ccb1c3973aa0330d1903da601cc9b5dee3c662b4cad149, "not a Meteora DBC pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Trends, CURVEmPpijXDTNdqrA9PGP1io2rkgiVXH26xdXVGLLfz: a bonding curve's `swap`, the Meteora DBC's data
// on its own accounts. The slot is `[program, pool, config, poolAuthority, baseVault, quoteVault,
// eventAuthority]`. The swap reads its direction from the paying account's mint.
function swapTrends(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xaa76ece759ebba1a789886f2c5a37a7bb11a5811decc9fd5582a5b983f9b4769, "not a Trends pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const sellsBase = svm.sload(slot[4], 0, 32).toBe() == payMint.address;
  const baseMint = sellsBase ? payMint : buyMint;
  const quoteMint = sellsBase ? buyMint : payMint;
  svm.call(
    program,
    [
      slot[2],
      slot[1],
      slot[3],
      trader[1],
      recipient,
      baseMint,
      quoteMint,
      slot[4],
      slot[5],
      trader[0],
      baseMint.owner == token2022.address ? token2022 : tokenProgram,
      quoteMint.owner == token2022.address ? token2022 : tokenProgram,
      program,
      slot[6],
      program,
    ],
    trendsData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Trends' `swap`: exact input of `amountIn`, `minOut` its least out. The direction is the accounts'.
export function trendsData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(16));
}

// Skips an empty side.
export function trends(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0xaa76ece759ebba1a789886f2c5a37a7bb11a5811decc9fd5582a5b983f9b4769 &&
    pool.owner ==
      0xaa76ece759ebba1a789886f2c5a37a7bb11a5811decc9fd5582a5b983f9b4769, "not a Trends pool");
  const sellsBase = svm.sload(slot[4], 0, 32).toBe() == trader[2].address;
  if (svm.sload(sellsBase ? slot[5] : slot[4], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapTrends(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the config, the pool, the pool authority, the authority's paying and receiving token
// accounts, the base and quote mints, the base and quote vaults, the authority, the mints' token
// programs, the program itself (no referral), the event authority, and the program itself.
export function trendsCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0xaa76ece759ebba1a789886f2c5a37a7bb11a5811decc9fd5582a5b983f9b4769, "not a Trends pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Heaven, HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o: `sell` (the token for SOL) and `buy`, priced
// against Chainlink's SOL/USD feed. The slot is `[program, pool, vaultA, vaultB, protocolConfig,
// instructionsSysvar, chainlink, solUsdFeed, associatedTokenProgram, systemProgram]`: token A is the
// launched token, token B wrapped SOL. The swap writes the authority, so it has to be attached
// writable.
function swapHeaven(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xf11a449d46b98508822f426a0490132f445500841f0d9389a6d88bbc743c7f48, "not a Heaven pool");
  const payMint = trader[2];
  const buyMint = trader[3];
  const tokenProgram = trader[4];
  const token2022 = trader[5];
  const sells = svm.sload(slot[2], 0, 32).toBe() == payMint.address;
  const mintA = sells ? payMint : buyMint;
  const mintB = sells ? buyMint : payMint;
  svm.call(
    program,
    [
      mintA.owner == token2022.address ? token2022 : tokenProgram,
      mintB.owner == token2022.address ? token2022 : tokenProgram,
      slot[8],
      slot[9],
      slot[1],
      trader[0],
      mintA,
      mintB,
      sells ? trader[1] : recipient,
      sells ? recipient : trader[1],
      slot[2],
      slot[3],
      slot[4],
      slot[5],
      slot[6],
      slot[7],
    ],
    heavenData(amountIn, minOut == 0 ? 1 : minOut, sells),
  );
}

// Heaven's `sell` of `amountIn` of its token A (`aToB`) or `buy` with `amountIn` of SOL, `minOut` its
// least out.
export function heavenData(amountIn: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then the event's empty name.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const sell = hex`33e685a4017f83ad`;
  const buy = hex`66063d1201daebea`;
  const ix = aToB ? sell : buy;
  return ix.concat(word.toBytesLe(20));
}

// Skips an empty side.
export function heaven(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0xf11a449d46b98508822f426a0490132f445500841f0d9389a6d88bbc743c7f48 &&
    pool.owner ==
      0xf11a449d46b98508822f426a0490132f445500841f0d9389a6d88bbc743c7f48, "not a Heaven pool");
  const sells = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  if (svm.sload(sells ? slot[3] : slot[2], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapHeaven(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: token A's and token B's programs, the Associated Token program, the System program,
// the pool, the authority (writable), mints A and B, the authority's A and B token accounts (the
// paying one among them), the pool's A and B vaults, the protocol config, the Instructions sysvar,
// Chainlink's program and its SOL/USD feed. It sells token A when `aToB`.
export function heavenCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xf11a449d46b98508822f426a0490132f445500841f0d9389a6d88bbc743c7f48, "not a Heaven pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then the event's empty name.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const sell = hex`33e685a4017f83ad`;
  const buy = hex`66063d1201daebea`;
  const ix = aToB ? sell : buy;
  const data = ix.concat(word.toBytesLe(20));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Virtuals, 5U3EU2ubXtK84QcRjWVmYt9RaDyA8gKxdUrPFXmZyaki: `sell`, the launched token for VIRTUAL. Its
// `buy` takes the tokens to buy rather than what to pay, so it is not here. The slot is `[program,
// pool, poolTokenAccount, platform, platformVirtualsAccount, poolVirtualsAccount]`, the pool's and
// the platform's token accounts. Its swap takes SPL Token for both tokens.
function swapVirtuals(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x425bf4171973f0c028277e1db97808d543063ae1bc573e0cb8f4077d1faa284b, "not a Virtuals pool");
  require(svm.sload(slot[2], 0, 32).toBe() == trader[2].address, "Virtuals only sells its token");
  svm.call(
    program,
    [
      trader[0],
      slot[1],
      trader[2],
      recipient,
      trader[1],
      slot[2],
      slot[3],
      slot[4],
      slot[5],
      trader[4],
    ],
    virtualsData(amountIn, minOut == 0 ? 1 : minOut),
  );
}

// Virtuals' `sell` of `amountIn` of the launched token, `minOut` its least out.
export function virtualsData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const sell = hex`33e685a4017f83ad`;
  return sell.concat(word.toBytesLe(16));
}

// Skips an empty side.
export function virtuals(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0x425bf4171973f0c028277e1db97808d543063ae1bc573e0cb8f4077d1faa284b &&
    pool.owner ==
      0x425bf4171973f0c028277e1db97808d543063ae1bc573e0cb8f4077d1faa284b, "not a Virtuals pool");
  if (svm.sload(slot[5], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapVirtuals(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the pool, the token's mint, the authority's VIRTUAL and token accounts
// (the token one paying), the pool's token account, the platform, its VIRTUAL account, the pool's
// VIRTUAL account, and SPL Token.
export function virtualsCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x425bf4171973f0c028277e1db97808d543063ae1bc573e0cb8f4077d1faa284b, "not a Virtuals pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const sell = hex`33e685a4017f83ad`;
  const data = sell.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Raydium LaunchLab, LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: `sell_exact_in` and `buy_exact_in`,
// with no platform share. Its swap takes more accounts than a function can list, so it has only its
// `Cpi` and `Data` forms.
// Raydium LaunchLab's `sell_exact_in` of `amountIn` of the base token (`paysBase`) or `buy_exact_in`
// with `amountIn` of the quote token, `minOut` its least out.
export function raydiumLaunchlabData(amountIn: Uint256, minOut: Uint256, paysBase: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then a zero share rate.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const sell = hex`9527de9bd37c981a`;
  const buy = hex`faea0d7bd59c13ec`;
  const ix = paysBase ? sell : buy;
  return ix.concat(word.toBytesLe(24));
}

// `accounts`: the authority (writable), the program's authority, the global config, the platform
// config, the pool, the authority's base and quote token accounts (the paying one among them), the
// pool's base and quote vaults, the base and quote mints, their token programs, the event authority,
// the program itself, then the System program, the platform's fee vault and the creator's. It sells
// the base token when `paysBase`. A creator's fee vault that does not exist yet is created, the
// authority paying its rent, which a Pot cannot.
export function raydiumLaunchlabCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0x05043b954dca26e1ef91b52c4f8f89af8a6f5ac8c62156f171cf0f21ac51c922, "not a Raydium LaunchLab pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then a zero share rate.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const sell = hex`9527de9bd37c981a`;
  const buy = hex`faea0d7bd59c13ec`;
  const ix = paysBase ? sell : buy;
  const data = ix.concat(word.toBytesLe(24));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Runner Rodeo, runnrXXdsSRkdueCRYxKDvSWfv6nAnrG5dcM29qj1HA: `swap`. Its swap takes more accounts than a
// function can list, so it has only its `Cpi` and `Data` forms.
// Runner Rodeo's `swap`: exact input of `amountIn`, `minOut` its least out. The direction is the
// accounts'.
export function runnerRodeoData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(16));
}

// `accounts`: the program's authority, the authority (writable), the config, the pool, the
// authority's paying and receiving token accounts, the base and quote vaults, the protocol's two fee
// accounts and the creator's, the base and quote mints, their token programs, the System program,
// the event authority, and the program itself.
export function runnerRodeoCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x0cc9261f431106898771b2351ba8fb1e971c126de8a97be35dd541d18070a979, "not a Runner Rodeo pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Scale vMM, SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa: `buy` (paying token A) and `sell`. Its swap
// takes more accounts than a function can list, so it has only its `Cpi` and `Data` forms.
// Scale vMM's `buy`, paying token A (`aToB`), or `sell`: exact input of `amountIn`, `minOut` its
// least out.
export function scaleVmmData(amountIn: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const buy = hex`66063d1201daebea`;
  const sell = hex`33e685a4017f83ad`;
  const ix = aToB ? buy : sell;
  return ix.concat(word.toBytesLe(16));
}

// `accounts`: the pair, the authority (writable), mints A and B, the authority's A and B token
// accounts (the paying one among them), vaults A and B, the platform's A fee account, A's and B's
// token programs, the System program, the platform config, the Scale AMM program and its pool, vaults
// and config (for a swap that graduates the pair), and each fee beneficiary's token account. It
// buys, paying token A, when `aToB`.
export function scaleVmmCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x067423cf82a920c91a0c21e7e8be45af210e1f3d1b89c22f7cb955b76fb52cfb, "not a Scale vMM pair");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const buy = hex`66063d1201daebea`;
  const sell = hex`33e685a4017f83ad`;
  const ix = aToB ? buy : sell;
  const data = ix.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Liquid staking, lending and vault tokens: a deposit of the underlying token for the venue's own, or
// a withdrawal back, at the venue's own rate. A native-SOL stake pool (Sanctum's SPL stake pools,
// whose deposit takes the authority's own lamports) is not here: a Pot holds no native SOL it can
// pay out.

// xORCA, StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT: `stake`, ORCA for xORCA at the vault's rate; it
// only stakes. The slot is `[program, state, vault, xorcaMint]`. The swap writes the authority, so it
// has to be attached writable.
function swapXorca(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x06a1d5e7ca99ec0b8eed2daf06b98892ae05fccb112a2eaf1b6fae785e76a23c, "not an xORCA stake");
  require(svm.sload(slot[2], 0, 32).toBe() == trader[2].address, "xORCA only stakes ORCA");
  svm.call(
    program,
    [trader[0], slot[2], trader[1], recipient, slot[3], slot[1], trader[2], trader[4]],
    xorcaData(amountIn),
  );
}

// xORCA's `stake` of `amountIn` of ORCA. It carries no least out.
export function xorcaData(amountIn: Uint256): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const stake = hex`00`;
  return stake.concat(word.toBytesLe(8));
}

// Skips nothing past a missing slot and no input: the stake mints what it is paid for.
export function xorca(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0x06a1d5e7ca99ec0b8eed2daf06b98892ae05fccb112a2eaf1b6fae785e76a23c &&
    pool.owner ==
      0x06a1d5e7ca99ec0b8eed2daf06b98892ae05fccb112a2eaf1b6fae785e76a23c, "not an xORCA stake");
  const before = svm.sload(recipient, 64, 8).toLe();
  swapXorca(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority (writable), the vault, the authority's ORCA and xORCA token accounts (the
// ORCA one paying), the xORCA mint, the state, the ORCA mint, and SPL Token.
export function xorcaCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
): Uint256 {
  require(program.address ==
    0x06a1d5e7ca99ec0b8eed2daf06b98892ae05fccb112a2eaf1b6fae785e76a23c, "not an xORCA stake");
  const word = amountIn & 0xffffffffffffffff;
  const stake = hex`00`;
  const data = stake.concat(word.toBytesLe(8));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Solayer, endoLNCKTqDn8gSVnN2hDdpgACUPWHZTwoYnnMybpAT: `delegate`, a liquid-staking token for the
// pool's receipt token one for one, and `undelegate` back. The slot is `[program, pool, receiptMint,
// vault, lstMint]`.
function swapSolayer(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x09ae16c7e609a24396439f544af597a122cab0f5cf7348a968565ff9e88fb5d0, "not a Solayer pool");
  const delegates = slot[4].address == trader[2].address;
  svm.call(
    program,
    [
      trader[0],
      slot[1],
      slot[2],
      slot[3],
      slot[4],
      delegates ? trader[1] : recipient,
      delegates ? recipient : trader[1],
      trader[4],
    ],
    solayerData(amountIn, delegates),
  );
}

// Solayer's `delegate` of `amountIn` of the staking token (`aToB`) or `undelegate` of the receipt
// token. It carries no least out.
export function solayerData(amountIn: Uint256, aToB: bool): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const delegate = hex`fe00de2891766e14`;
  const undelegate = hex`d511d75105727c4e`;
  const ix = aToB ? delegate : undelegate;
  return ix.concat(word.toBytesLe(8));
}

// Skips an undelegation the vault holds nothing for.
export function solayer(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0x09ae16c7e609a24396439f544af597a122cab0f5cf7348a968565ff9e88fb5d0 &&
    pool.owner ==
      0x09ae16c7e609a24396439f544af597a122cab0f5cf7348a968565ff9e88fb5d0, "not a Solayer pool");
  if (slot[4].address != trader[2].address && svm.sload(slot[3], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapSolayer(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the pool, the receipt mint, the vault, the staking token's mint, the
// authority's staking-token and receipt-token accounts (the paying one among them), and SPL Token. It
// delegates when `aToB`.
export function solayerCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x09ae16c7e609a24396439f544af597a122cab0f5cf7348a968565ff9e88fb5d0, "not a Solayer pool");
  const word = amountIn & 0xffffffffffffffff;
  const delegate = hex`fe00de2891766e14`;
  const undelegate = hex`d511d75105727c4e`;
  const ix = aToB ? delegate : undelegate;
  const data = ix.concat(word.toBytesLe(8));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Voltr, vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8: a vault's `deposit_vault` of its asset for LP
// tokens and `request_and_withdraw_vault` back. The slot is `[program, vault, protocol, lpMint,
// idleAta, idleAuthority, lpMintAuthority, systemProgram]`. The swap requires the authority's
// associated token accounts, and a withdrawal writes the idle authority.
function swapVoltr(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x0db4588c00282e3906bc90f790d4706811e8cc24b29cca991b4d70db3aa58d39, "not a Voltr vault");
  const lpMint = slot[3];
  const deposits = lpMint.address != trader[2].address;
  const asset = deposits ? trader[2] : trader[3];
  const assetProgram = asset.owner == trader[5].address ? trader[5] : trader[4];
  const lpProgram = lpMint.owner == trader[5].address ? trader[5] : trader[4];
  if (deposits) {
    svm.call(
      program,
      [
        trader[0],
        slot[2],
        slot[1],
        asset,
        lpMint,
        trader[1],
        slot[4],
        slot[5],
        recipient,
        slot[6],
        assetProgram,
        lpProgram,
        slot[7],
      ],
      voltrData(amountIn, true),
    );
  } else {
    svm.call(
      program,
      [
        trader[0],
        slot[2],
        slot[1],
        asset,
        lpMint,
        trader[1],
        slot[4],
        slot[5],
        recipient,
        assetProgram,
        lpProgram,
        slot[7],
      ],
      voltrData(amountIn, false),
    );
  }
}

// Voltr's `deposit_vault` of `amountIn` of the asset (`aToB`) or `request_and_withdraw_vault` of
// `amountIn` of LP tokens. It carries no least out.
export function voltrData(amountIn: Uint256, aToB: bool): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const deposit = hex`7ee015ffe4357521`;
  const withdraw = hex`dd3873a880dcebf5`;
  // A withdrawal names its amount in LP tokens, not all of them.
  const inLp = hex`0100`;
  return aToB ? deposit.concat(word.toBytesLe(8)) : withdraw.concat(word.toBytesLe(8), inLp);
}

// Skips a withdrawal its idle account holds nothing for.
export function voltr(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0x0db4588c00282e3906bc90f790d4706811e8cc24b29cca991b4d70db3aa58d39 &&
    pool.owner ==
      0x0db4588c00282e3906bc90f790d4706811e8cc24b29cca991b4d70db3aa58d39, "not a Voltr vault");
  if (slot[3].address == trader[2].address && svm.sload(slot[4], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapVoltr(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: a deposit's (`aToB`) the authority, the protocol, the vault, the asset and LP mints,
// the authority's asset account, the vault's idle account and its authority, the authority's LP
// account, the LP mint's authority, the two mints' token programs and the System program; a
// withdrawal's the same with the LP account paying and the asset one receiving, and no LP mint
// authority.
export function voltrCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x0db4588c00282e3906bc90f790d4706811e8cc24b29cca991b4d70db3aa58d39, "not a Voltr vault");
  const word = amountIn & 0xffffffffffffffff;
  const deposit = hex`7ee015ffe4357521`;
  const withdraw = hex`dd3873a880dcebf5`;
  // A withdrawal names its amount in LP tokens, not all of them.
  const inLp = hex`0100`;
  const data = aToB ? deposit.concat(word.toBytesLe(8)) : withdraw.concat(word.toBytesLe(8), inLp);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// The liquid-unstake vault, 2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo: `liquid_unstake`, a liquid
// staking token for wrapped SOL at its stake pool's rate less a fee; it only unstakes. The slot is
// `[program, lstInfo, globalPool, poolLstAccount, stakePool, solVault, feeAccount,
// inventorySummary, systemProgram]`. The wrapped SOL lands in a native wrapped-SOL account.
function swapVaultLiquidUnstake(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x1b87b0eb9e6114a494016f2c1359dd21ace512413838ac59b308e05d7d53d54e, "not a liquid-unstake vault");
  svm.call(
    program,
    [
      slot[2],
      slot[3],
      trader[0],
      trader[1],
      recipient,
      trader[2],
      slot[4],
      slot[1],
      slot[5],
      slot[6],
      slot[7],
      trader[4],
      slot[8],
    ],
    vaultLiquidUnstakeData(amountIn),
  );
}

// The liquid-unstake vault's `liquid_unstake` of `amountIn` of the staking token. It carries no
// least out.
export function vaultLiquidUnstakeData(amountIn: Uint256): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const unstake = hex`64034fd1bf9db40b`;
  return unstake.concat(word.toBytesLe(9));
}

// Skips nothing past a missing slot and no input.
export function vaultLiquidUnstake(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0x1b87b0eb9e6114a494016f2c1359dd21ace512413838ac59b308e05d7d53d54e &&
    pool.owner ==
      0x1b87b0eb9e6114a494016f2c1359dd21ace512413838ac59b308e05d7d53d54e, "not a liquid-unstake vault");
  const before = svm.sload(recipient, 64, 8).toLe();
  swapVaultLiquidUnstake(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the global pool, its staking-token account, the authority, the authority's staking-token
// and wrapped-SOL accounts, the staking token's mint, its stake pool, its info account, the SOL
// vault, the fee account, the inventory summary, SPL Token and the System program.
export function vaultLiquidUnstakeCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
): Uint256 {
  require(program.address ==
    0x1b87b0eb9e6114a494016f2c1359dd21ace512413838ac59b308e05d7d53d54e, "not a liquid-unstake vault");
  const word = amountIn & 0xffffffffffffffff;
  const unstake = hex`64034fd1bf9db40b`;
  const data = unstake.concat(word.toBytesLe(9));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Hylo's stability pool, HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ: `user_deposit`, hyUSD for its LP
// token, and `user_withdraw` back. The slot is `[program, poolConfig, hylo, stablecoinPool,
// poolAuthority, lpTokenAuthority, lpTokenMint, feeAuthority, feeVault, eventAuthority]`. The swap
// writes the authority, so it has to be attached writable, and a withdrawal writes the pool config.
function swapHyloStabilityPool(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xfc4c91c8b89aa379a494b13a608015253d4e3818339a9bf4ec207f88279671e1, "not a Hylo stability pool");
  const lpMint = slot[6];
  const deposits = lpMint.address != trader[2].address;
  if (deposits) {
    svm.call(
      program,
      [
        trader[0],
        slot[1],
        slot[2],
        trader[2],
        trader[1],
        recipient,
        slot[4],
        slot[3],
        slot[5],
        lpMint,
        trader[4],
        slot[9],
        program,
      ],
      hyloStabilityPoolData(amountIn, true),
    );
  } else {
    svm.call(
      program,
      [
        trader[0],
        slot[1],
        slot[2],
        trader[3],
        recipient,
        slot[7],
        slot[8],
        trader[1],
        slot[4],
        slot[3],
        lpMint,
        trader[4],
        slot[9],
        program,
      ],
      hyloStabilityPoolData(amountIn, false),
    );
  }
}

// Hylo's stability pool's `user_deposit` of `amountIn` of hyUSD (`aToB`) or `user_withdraw` of
// `amountIn` of its LP token. It carries no least out.
export function hyloStabilityPoolData(amountIn: Uint256, aToB: bool): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const deposit = hex`bac68ce981276299`;
  const withdraw = hex`35fe1af277ed4921`;
  // No slippage configuration.
  const ix = aToB ? deposit : withdraw;
  return ix.concat(word.toBytesLe(9));
}

// Skips nothing past a missing slot and no input.
export function hyloStabilityPool(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0xfc4c91c8b89aa379a494b13a608015253d4e3818339a9bf4ec207f88279671e1 &&
    pool.owner ==
      0xfc4c91c8b89aa379a494b13a608015253d4e3818339a9bf4ec207f88279671e1, "not a Hylo stability pool");
  const before = svm.sload(recipient, 64, 8).toLe();
  swapHyloStabilityPool(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: a deposit's (`aToB`) the authority (writable), the pool config, Hylo, the hyUSD mint,
// the authority's hyUSD and LP accounts, the pool authority, the stablecoin pool, the LP token's
// authority and mint, SPL Token, the event authority and the program itself; a withdrawal's the
// authority, the pool config (writable), Hylo, the hyUSD mint, the authority's hyUSD account, the fee
// authority and vault, the authority's LP account, the pool authority, the stablecoin pool, the LP
// mint, SPL Token, the event authority and the program itself.
export function hyloStabilityPoolCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xfc4c91c8b89aa379a494b13a608015253d4e3818339a9bf4ec207f88279671e1, "not a Hylo stability pool");
  const word = amountIn & 0xffffffffffffffff;
  const deposit = hex`bac68ce981276299`;
  const withdraw = hex`35fe1af277ed4921`;
  // No slippage configuration.
  const ix = aToB ? deposit : withdraw;
  const data = ix.concat(word.toBytesLe(9));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Huma, HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn: `deposit` of a pool's underlying token for a
// mode's token, with no commitment; it only deposits (a withdrawal needs the lender's own accounts
// created first). The slot is `[program, modeConfig, humaConfig, poolConfig, poolState, modeMint,
// poolAuthority, poolUnderlying]`.
function swapHuma(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0xfb3f98f4db5c033579af051e753d17fc7b249475dd0525b72a2cc5719ad077b1, "not a Huma pool");
  require(slot[5].address == trader[3].address, "Huma only deposits");
  svm.call(
    program,
    [
      trader[0],
      slot[2],
      slot[3],
      slot[4],
      slot[1],
      slot[5],
      slot[6],
      trader[2],
      slot[7],
      trader[1],
      recipient,
      trader[2].owner == trader[5].address ? trader[5] : trader[4],
      slot[5].owner == trader[5].address ? trader[5] : trader[4],
    ],
    humaData(amountIn),
  );
}

// Huma's `deposit` of `amountIn` of the underlying token, with no commitment. It carries no least
// out.
export function humaData(amountIn: Uint256): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const deposit = hex`f223c68952e1f2b6`;
  // The deposit's commitment, the string "NO_COMMITMENT", then no referral.
  const commitment = hex`0d0000004e4f5f434f4d4d49544d454e5400`;
  return deposit.concat(word.toBytesLe(8), commitment);
}

// Skips nothing past a missing slot and no input.
export function huma(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0xfb3f98f4db5c033579af051e753d17fc7b249475dd0525b72a2cc5719ad077b1 &&
    pool.owner ==
      0xfb3f98f4db5c033579af051e753d17fc7b249475dd0525b72a2cc5719ad077b1, "not a Huma pool");
  const before = svm.sload(recipient, 64, 8).toLe();
  swapHuma(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the Huma config, the pool config, the pool state, the mode config, the
// mode's mint, the pool authority, the underlying mint, the pool's underlying account, the
// authority's underlying and mode-token accounts (the underlying one paying), and the two mints'
// token programs.
export function humaCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
): Uint256 {
  require(program.address ==
    0xfb3f98f4db5c033579af051e753d17fc7b249475dd0525b72a2cc5719ad077b1, "not a Huma pool");
  const word = amountIn & 0xffffffffffffffff;
  const deposit = hex`f223c68952e1f2b6`;
  // The deposit's commitment, the string "NO_COMMITMENT", then no referral.
  const commitment = hex`0d0000004e4f5f434f4d4d49544d454e5400`;
  const data = deposit.concat(word.toBytesLe(8), commitment);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Helium's treasury management, treaf4wWBBty3fHdyBpo35Mz84M8k3heKXmjmi9vFt5: `redeem_v0`, a subnetwork
// token for HNT along the treasury's curve, behind its circuit breaker; it only redeems. The slot is
// `[program, management, supplyMint, treasury, circuitBreaker, circuitBreakerProgram]`.
function swapHeliumTreasury(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x0d48c2241255418477a5e5cde6f783f54df82234ddf5509d2643ed3de2e060f2, "not a Helium treasury");
  require(slot[2].address == trader[2].address, "the treasury only redeems its supply token");
  svm.call(
    program,
    [
      slot[1],
      trader[3],
      slot[2],
      slot[3],
      slot[4],
      trader[1],
      recipient,
      trader[0],
      slot[5],
      trader[4],
    ],
    heliumTreasuryData(amountIn, minOut),
  );
}

// Helium's `redeem_v0` of `amountIn` of the supply token, `minOut` its least out.
export function heliumTreasuryData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const redeem = hex`eb7fab8b774deb76`;
  return redeem.concat(word.toBytesLe(16));
}

// Skips an empty treasury.
export function heliumTreasury(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(slot[0].address == 0x0d48c2241255418477a5e5cde6f783f54df82234ddf5509d2643ed3de2e060f2 &&
    pool.owner ==
      0x0d48c2241255418477a5e5cde6f783f54df82234ddf5509d2643ed3de2e060f2, "not a Helium treasury");
  if (svm.sload(slot[3], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapHeliumTreasury(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the treasury management, the treasury's mint, the supply mint, the treasury, the circuit
// breaker, the authority's supply and treasury token accounts (the supply one paying), the
// authority, the circuit breaker program, and SPL Token.
export function heliumTreasuryCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x0d48c2241255418477a5e5cde6f783f54df82234ddf5509d2643ed3de2e060f2, "not a Helium treasury");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const redeem = hex`eb7fab8b774deb76`;
  const data = redeem.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Jupiter Lend Earn, jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9: `deposit` of an asset for its fToken
// and `redeem` back, through the Jupiter Lend liquidity program. Its swap takes more accounts than a
// function can list, so it has only its `Cpi` and `Data` forms.
// Jupiter Lend Earn's `deposit` of `amountIn` of the asset (`aToB`) or `redeem` of `amountIn` of the
// fToken. It carries no least out.
export function jupiterLendEarnData(amountIn: Uint256, aToB: bool): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const deposit = hex`f223c68952e1f2b6`;
  const redeem = hex`b80c569546c461e1`;
  const ix = aToB ? deposit : redeem;
  return ix.concat(word.toBytesLe(8));
}

// `accounts`: a deposit's (`aToB`) the authority (writable), its asset and fToken accounts, the
// asset's mint, the lending admin, the lending, the fToken mint, the reserve, the supply position,
// the rate model, the vault, the liquidity, the liquidity program, the rewards rate model, SPL Token,
// the Associated Token program and the System program; a redemption's the authority, its fToken and
// asset accounts, the lending admin, the lending, the asset's mint, the fToken mint, the reserve, the
// supply position, the rate model, the vault, the claim account, the liquidity, the liquidity
// program, the rewards rate model, SPL Token, the Associated Token program and the System program.
export function jupiterLendEarnCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x0afe1b912e485e95fd15eb2937dffc4b37a316d0a63812ff02ba49b4c6c18d1e, "not a Jupiter Lend vault");
  const word = amountIn & 0xffffffffffffffff;
  const deposit = hex`f223c68952e1f2b6`;
  const redeem = hex`b80c569546c461e1`;
  const ix = aToB ? deposit : redeem;
  const data = ix.concat(word.toBytesLe(8));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Hylo's exchange, HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn: `mint_stablecoin`, USDC for hyUSD, and
// `redeem_stablecoin` back. Its swap takes more accounts than a function can list, so it has only its
// `Cpi` and `Data` forms.
// Hylo's `mint_stablecoin` with `amountIn` of USDC (`aToB`) or `redeem_stablecoin` of `amountIn` of
// hyUSD. It carries no least out.
export function hyloData(amountIn: Uint256, aToB: bool): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const mint = hex`0e0ea31ae0b69f9b`;
  const redeem = hex`aaed62683c5248a1`;
  // No slippage configuration.
  const ix = aToB ? mint : redeem;
  return ix.concat(word.toBytesLe(9));
}

// `accounts`: the authority, Hylo, the pair, the hyUSD authority, the USDC vault's and fee's
// authorities, the hyUSD fee authority, the USDC vault, the USDC and hyUSD fee vaults, the
// authority's hyUSD and USDC accounts (the paying one among them), the hyUSD mint, the USDC mint,
// the Pyth price, SPL Token, the event authority and the program itself. It mints when `aToB`.
export function hyloCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xf5bb48a004743086c5a498bde9db1b7cc94167f33a528c5a0d965328df9e7c21, "not a Hylo exchange");
  const word = amountIn & 0xffffffffffffffff;
  const mint = hex`0e0ea31ae0b69f9b`;
  const redeem = hex`aaed62683c5248a1`;
  // No slippage configuration.
  const ix = aToB ? mint : redeem;
  const data = ix.concat(word.toBytesLe(9));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Carrot, CarrotwivhMpDnm27EHmRLeQ683Z1PufuqEmBZvD282s: `issue`, one of its vault's assets for CRT, and
// `redeem` back, logged through its log program. Its swap takes more accounts than a function can
// list, so it has only its `Cpi` and `Data` forms.
// Carrot's `issue` of CRT for `amountIn` of an asset (`aToB`) or `redeem` of `amountIn` of CRT. It
// carries no least out.
export function carrotData(amountIn: Uint256, aToB: bool): bytes {
  const word = amountIn & 0xffffffffffffffff;
  const issue = hex`be0162d65163def7`;
  const redeem = hex`b80c569546c461e1`;
  const ix = aToB ? issue : redeem;
  return ix.concat(word.toBytesLe(8));
}

// `accounts`: the vault, the CRT mint, the authority's CRT account, the asset's mint, the vault's
// account for it, the authority's asset account, the authority (writable), the System program, the
// asset's and CRT's token programs, the log program, then each of the vault's assets' account and
// oracle. It issues when `aToB`.
export function carrotCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0xac1d192f4e13005a44f45897e38e0e80a8eb79a15a33a3f88d0ef226aa441c70, "not a Carrot vault");
  const word = amountIn & 0xffffffffffffffff;
  const issue = hex`be0162d65163def7`;
  const redeem = hex`b80c569546c461e1`;
  const ix = aToB ? issue : redeem;
  const data = ix.concat(word.toBytesLe(8));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// M0's swap, MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH: `swap`, one of M's extension tokens for
// another one for one, unwrapping through the paying extension's program and wrapping through the
// buying one's. Its swap takes more accounts than a function can list, so it has only its `Cpi` and
// `Data` forms.
// M0's `swap` of `amountIn` of the paying extension's token. It carries no least out, and reads its
// direction from its accounts.
export function mswapData(amountIn: Uint256): bytes {
  // The amount, then the remaining accounts' split: none, no mint has a transfer hook.
  const word = amountIn & 0xffffffffffffffff;
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(9));
}

// `accounts`: the authority, the program itself twice (no wrap or unwrap authority), the swap's
// global, the paying and the buying extension's global and mint, M's mint, the paying and receiving
// token accounts, the swap's M account, each extension's M vault authority, mint authority and M
// vault, each extension's token program, M's, each extension's program and the System program: the
// paying extension's first of each pair.
export function mswapCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
): Uint256 {
  require(program.address ==
    0x053cf2a7380b11366172e37227a7650da1beebda70dc7f597eae9717258223be, "not an M swap");
  const word = amountIn & 0xffffffffffffffff;
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(word.toBytesLe(9));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Jupiter Perpetuals, PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu: `swap2`, one of the JLP pool's
// tokens for another at their oracles' prices less the pool's fee. Its swap takes more accounts than
// a function can list, so it has only its `Cpi` and `Data` forms.
// Jupiter Perpetuals' `swap2` of `amountIn`, `minOut` its least out. It reads its direction from its
// accounts.
export function perpsJlpData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap2 = hex`414b3f4ceb5b5b88`;
  return swap2.concat(word.toBytesLe(16));
}

// `accounts`: the authority, the paying and receiving token accounts, the transfer authority, the
// perpetuals, the pool (writable), then the paid token's custody (writable), its Doves and Pythnet
// price accounts and its token account (writable), the same four of the bought token, SPL Token, the
// event authority and the program itself.
export function perpsJlpCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x05b1f3caf19462ef8760f0abde75cd3d9ee31b3a32c620e894122e9c9b8145fa, "not a Jupiter Perpetuals pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const swap2 = hex`414b3f4ceb5b5b88`;
  const data = swap2.concat(word.toBytesLe(16));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Jupiter Perpetuals' `addLiquidity2`, one of the JLP pool's tokens for JLP; it only mints. Its swap
// takes more accounts than a function can list, so it has only its `Cpi` and `Data` forms.
// `addLiquidity2` of `amountIn`, `minOut` its least JLP out, with no swap first.
export function perpsJlpMintData(amountIn: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then no amount to swap first.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const add = hex`e4a24e1c46db7473`;
  return add.concat(word.toBytesLe(17));
}

// `accounts`: the authority, the paying token account, the receiving JLP account, the transfer
// authority, the perpetuals, the pool (writable), the paid token's custody (writable), its Doves and
// Pythnet price accounts and its token account (writable), JLP's mint (writable), SPL Token, the event
// authority, the program itself, then each of the pool's custodies and each one's oracle.
export function perpsJlpMintCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x05b1f3caf19462ef8760f0abde75cd3d9ee31b3a32c620e894122e9c9b8145fa, "not a Jupiter Perpetuals pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64);
  const add = hex`e4a24e1c46db7473`;
  const data = add.concat(word.toBytesLe(17));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Sanctum Infinity, 5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx: `swap_exact_in`, one of its pool's
// liquid staking tokens (or wrapped SOL) for another at their calculators' SOL values less the pool's
// fee. Its swap takes more accounts than a function can list, so it has only its `Cpi` and `Data`
// forms.
// Sanctum Infinity's `swap_exact_in` of `amountIn`: the number of accounts each token's calculator
// takes (1 for wrapped SOL's, 5 for a stake pool's), each token's index in the pool's list, and
// `minOut`, its least out.
export function sanctumInfinityData(
  amountIn: Uint256,
  inCalcAccounts: Uint256,
  outCalcAccounts: Uint256,
  inIndex: Uint256,
  outIndex: Uint256,
  minOut: Uint256,
): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require((inCalcAccounts | outCalcAccounts) <= 255 &&
    (inIndex | outIndex) <= 0xffffffff, "index past its field");
  // The instruction, the counts, the indices, the floor, then the amount.
  const word =
    0x17 |
    (inCalcAccounts << 8) |
    (outCalcAccounts << 16) |
    (inIndex << 24) |
    (outIndex << 56) |
    (minOut << 88) |
    ((amountIn & 0xffffffffffffffff) << 152);
  return word.toBytesLe(27);
}

// `accounts`: the authority, the paid and bought mint, the paying and receiving token accounts, each
// mint's token program, the pool state and the LST list (both writable), the paid and bought token's
// reserves (writable), then the paid token's calculator program and its accounts, the bought
// token's, the pricing program and its slab. A stake pool's calculator takes its state, the stake
// pool, the stake pool's program and that program's data; wrapped SOL's takes none.
export function sanctumInfinityCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  inCalcAccounts: Uint256,
  outCalcAccounts: Uint256,
  inIndex: Uint256,
  outIndex: Uint256,
  minOut: Uint256,
): Uint256 {
  require(program.address ==
    0x475fed1dc0fff39bbf237b19aa9747fb56d4b0ddf233a21343c942d64e1883dd, "not a Sanctum Infinity pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  require((inCalcAccounts | outCalcAccounts) <= 255 &&
    (inIndex | outIndex) <= 0xffffffff, "index past its field");
  const word =
    0x17 |
    (inCalcAccounts << 8) |
    (outCalcAccounts << 16) |
    (inIndex << 24) |
    (outIndex << 56) |
    (minOut << 88) |
    ((amountIn & 0xffffffffffffffff) << 152);
  const data = word.toBytesLe(27);
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// SolFi v1, SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe: `swap`, at its pool's pushed prices. The
// slot is `[program, pool, vaultA, vaultB, instructionsSysvar]`. Its liquidity has moved to SolFi
// v2: every pool it lists holds an empty vault.
function swapSolfiV1(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): void {
  const program = slot[0];
  require(program.address ==
    0x069be86ec9af65eb4a614fd99b8e92547da0145fab5e804adb594db3e73a271b, "not a SolFi v1 pool");
  const paysA = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  svm.call(
    program,
    [
      trader[0],
      slot[1],
      slot[2],
      slot[3],
      paysA ? trader[1] : recipient,
      paysA ? recipient : trader[1],
      trader[4],
      slot[4],
    ],
    solfiV1Data(amountIn, minOut == 0 ? 1 : minOut, paysA),
  );
}

// SolFi v1's `swap` of `amountIn`, `minOut` its least out, paying token A when `aToB`.
export function solfiV1Data(amountIn: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  // The amount, the floor, then the direction: 0 pays token A.
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((aToB ? 0 : 1) << 128);
  const swap = hex`07`;
  return swap.concat(word.toBytesLe(17));
}

// Skips an empty side.
export function solfiV1(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  require(pool.owner ==
    0x069be86ec9af65eb4a614fd99b8e92547da0145fab5e804adb594db3e73a271b, "not a SolFi v1 pool");
  const paysA = svm.sload(slot[2], 0, 32).toBe() == trader[2].address;
  if (svm.sload(paysA ? slot[3] : slot[2], 64, 8).toLe() == 0) {
    return 0;
  }
  const before = svm.sload(recipient, 64, 8).toLe();
  swapSolfiV1(slot, trader, amountIn, minOut, recipient);
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `accounts`: the authority, the pool (writable), its A and B vaults (writable), the authority's A
// and B token accounts (the paying one among them), SPL Token, and the Instructions sysvar. It pays
// A when `aToB`.
export function solfiV1Cpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  minOut: Uint256,
  aToB: bool,
): Uint256 {
  require(program.address ==
    0x069be86ec9af65eb4a614fd99b8e92547da0145fab5e804adb594db3e73a271b, "not a SolFi v1 pool");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((aToB ? 0 : 1) << 128);
  const swap = hex`07`;
  const data = swap.concat(word.toBytesLe(17));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}

// Archer, Archer8kgiavM61GyusMzaaS2ft5sALtNsD1HxkUPMhy: `swap` against its market's makers' quotes.
// Its makers vary in number, so it has only its `Cpi` and `Data` forms.
// Archer's `swap` of `amountIn`, `minOut` its least out: selling the base token (`paysBase`) in whole
// base lots of `baseLot` each, buying it in the quote token's own units, of which it spends the whole
// lots' cost.
export function archerData(
  amountIn: Uint256,
  baseLot: Uint256,
  minOut: Uint256,
  paysBase: bool,
): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const amount = paysBase ? amountIn / baseLot : amountIn;
  // The amount, the floor, then the side (1 sells the base token) and a zero byte.
  const word = (amount & 0xffffffffffffffff) | (minOut << 64) | ((paysBase ? 1 : 0) << 128);
  const swap = hex`0f`;
  return swap.concat(word.toBytesLe(18));
}

// `accounts`: the authority (writable), the market (writable), the authority's quote token account,
// the base and quote mints, the market's base and quote vaults (writable), the authority's base and
// quote token accounts (the paying one among them), the base and quote mints' token programs, then
// each maker (writable).
export function archerCpi(
  program: Account,
  accounts: Account[],
  source: Account,
  amountIn: Uint256,
  baseLot: Uint256,
  minOut: Uint256,
  paysBase: bool,
): Uint256 {
  require(program.address ==
    0x926f0255ffab30ed280f30883c8dcaf28cf91c32f965d74ea8aeb152888409d8, "not an Archer market");
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const amount = paysBase ? amountIn / baseLot : amountIn;
  const word = (amount & 0xffffffffffffffff) | (minOut << 64) | ((paysBase ? 1 : 0) << 128);
  const swap = hex`0f`;
  const data = swap.concat(word.toBytesLe(18));
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}
