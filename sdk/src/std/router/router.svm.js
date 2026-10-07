// @sauce/router — SVM arm. One function per Solana venue whose swap takes a price limit, and
// Manifest's book.
//
// Every swap here is a LIMIT ORDER at one pool: it offers the pool up to `amountIn` of the token
// paid and lets the pool trade until its price reaches the limit; the pool takes only what it
// swapped before that and leaves the rest in the paying account, so nothing is stranded. Every swap
// is EXACT INPUT up to the limit: nothing here can express an exact-output swap. Every function
// takes RUN-TIME arguments. There are four forms of each venue's swap:
//
//   try<Venue>(slot, trader, amountIn, maxPrice, minOut, recipient)          at a price
//   try<Venue>AtLimit(slot, trader, amountIn, limit, minOut, recipient)      at the pool's own limit
//   <venue>Cpi(program, accounts, source, amountIn, limit, …)                its instruction alone
//   <venue>Data(amountIn, limit, …)                                          its instruction's data
//
// with a plain form of each `try` form (`raydiumClmm`, `raydiumClmmAtLimit`, …) that reverts where
// it returns 0, and `trySwap`/`swap`, which take a pool at any of the nine venues of the first form
// and read its venue from `pool.owner`. The first form is the nine venues' (Raydium CLMM,
// PancakeSwap CLMM, Byreal, Stabble CLMM, Orca Whirlpools, Cropper, DefiTuna, Crema, Phoenix); the
// other three are theirs and Invariant's and OpenBook v2's, which take `priceLots` and `orders` in
// place of `limit`; Manifest's swap takes no limit, so its functions (`tryManifest`, `manifest`,
// `manifestCpi`, `manifestData`) take none. Orca has two data functions, its classic `swap`'s
// (`orcaWhirlpoolData`) and `swap_v2`'s (`orcaWhirlpoolV2Data`). The `try` forms return what the
// recipient received; `…Cpi` what the paying account paid; `…Data` the bytes. Every form sends the
// same instruction for the same amount, limit and floor: they all build it with `…Data`.
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
// Past the nine: a Raydium-layout pool's slot may carry, tenth, its tick-array bitmap extension,
// which its swap reads past the pool's default range (a slot of nine, or the System program there,
// sends none); Invariant's carries its program's authority (its `config` is the program's state,
// `extra` the pool's tickmap, its ticks the tick accounts the swap may cross); OpenBook v2's its two
// oracles (the program itself for one the market has not; its `config` is the market's authority,
// `extra` its event heap, its ticks its bids, its asks and the System program). Crema's swap refuses a
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
// AT A PRICE. `maxPrice` is the most one unit bought may cost, fee included, as payToken base units
// per buyToken base unit times 1e18. A concentrated-liquidity pool's price is a Q64.64 square root of
// the higher-key token per lower-key token (the pair in the order of the mints' 32-byte keys), and it
// takes its fee from the input, so its last unit costs its price divided by `1 − fee`. Each function
// reads the pool's fee and moves `maxPrice`'s square root toward the trade by `√(1 − fee)`: the
// pool's last unit, fee paid, then costs at most `maxPrice`, and every earlier unit less. A Phoenix
// market charges its taker fee on top, so its limit price is `maxPrice ÷ (1 + fee)`, in the market's
// ticks. A pool whose fee is more than one rate, which no such limit can hold, is skipped.
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
// takes for a pool of two SPL Token mints (`swap_v2`, which names each mint and its token program,
// for the rest).
//
// TRY FORMS. A failed call into another program aborts the whole Solana transaction and cannot be
// caught, so a Solana `try` form checks before anything moves: it returns 0 having moved nothing for
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
// foresee still aborts the transaction: a tick array missing from the slot. A slot that is not the
// pair, whose program is not the venue's or not the pool's owner, or whose pool no venue here owns
// (`trySwap`: "not a supported venue's pool"; a venue's own function: "not a <venue> pool"), and a
// limit or a floor its order cannot carry, revert: those are the caller's, not the pool's state. Only
// a missing slot, the System program itself as its pool, is skipped.
//
// Every venue's swap is its own instruction, called with `svm.call`. Its data is a few fixed bytes
// around little-endian integers, packed into one word and written with one `toBytesLe`, each field
// its low bytes (an amount 8, a limit 16; a floor past its 8 reverts). The price-limited forms read
// the pair's balances with `@sauce/token`'s checks; the others read the amount alone, which only a
// token account of the pair that a swap moved could hold.
//
// SIZE. A Solana program rides in transactions, so the arm shares code through functions (each
// venue's data, its accounts from a slot, its checks, `settled`) where the EVM arm keeps each
// function flat, and only the functions a program calls are compiled into it. `trySwap` takes any of
// the nine, so it carries all nine venues' code: a program calling it is about 5.8 KB, one calling a
// single venue's function about 0.9 to 2.0 KB, its instruction alone about 0.3 to 0.6 KB, its data
// alone about 0.2 to 0.4 KB. A program that knows its venue calls that venue's function; `trySwap` is
// for slots whose venue is only known when the program runs. Each venue's functions check its own program id, so a direct call never
// signs into a program the caller names; only `trySwap`'s internal path relies on its one read of the
// pool's owner.
//
// No module-level `const` here: a compile-time define replaces a same-named `const` in every module,
// this one included.
import { balanceOf } from "@sauce/token";

// ---------------------------------------------------------------------------------------------
// The concentrated-liquidity limit
// ---------------------------------------------------------------------------------------------

// A concentrated-liquidity pool's own limit for `maxPrice`, as a Q64.64 sqrt price, or 0 when the
// pool has nothing to sell within it (no liquidity at its price, or its price already at or past
// the limit) or the input is dust. Requires the pool's two mints, in key order, to be the pair paid
// (`pay`) and bought (`buy`). `fee` is in millionths, taken from the input.
function clmmLimit(
  mintA: Uint256,
  mintB: Uint256,
  liquidity: Uint256,
  price: Uint256,
  fee: Uint256,
  pay: Uint256,
  buy: Uint256,
  maxPrice: Uint256,
  amountIn: Uint256,
): Uint256 {
  const paysA = pay < buy;
  require(mintA == (paysA ? pay : buy) && mintB == (paysA ? buy : pay), "pool is not the pair");
  // maxPrice as a sqrt price: the higher-key token per lower-key token, times 2^64. Paying the
  // lower-key token it is upside down. Only the root the direction needs is taken.
  let limit = 0;
  if (paysA) {
    limit = Math.sqrt(Math.mulDiv(1 << 128, 10 ** 18, maxPrice));
  } else {
    limit = Math.sqrt(Math.mulDiv(maxPrice, 1 << 128, 10 ** 18));
  }
  // Moved by √(1 − fee), so that the pool's last unit, fee paid, costs exactly maxPrice. Paying the
  // lower-key token pushes the price down, the other up. The root is rounded down, so the limit sits
  // a hair inside the exact one: the pool stops a little sooner, never later.
  const root = Math.sqrt((1000000 - fee) * 10 ** 30); // √(1 − fee), times 1e18
  const own = paysA ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);
  const better = paysA ? price > own : price < own;
  if (liquidity == 0 || !better || dust(paysA, price, fee, amountIn)) {
    return 0;
  }
  return own;
}

// Whether a concentrated-liquidity pool can take `amountIn` toward a limit given in its own terms
// (0: none, the program's own bound): its two mints, in key order, must be `pay` and `buy`; it can
// when it has liquidity at its price, its price is not already at or past the limit, and the input
// is not dust at the pool's base fee.
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
// Each venue's instruction data
// ---------------------------------------------------------------------------------------------
//
// `<venue>Data` is a swap's instruction data alone, the one encoding every form here sends: a caller
// that keeps the venue's accounts and program itself (`@eco-incorp/sauce/svm`'s
// `routerSvmAccountOrder` names them in order) calls `svm.call(program, [accounts…], <venue>Data(…))`,
// the cheapest way to send it. The data is a few fixed bytes around little-endian integers, packed
// into one word and written with one `toBytesLe`, the dearest step of building it, so each field takes
// the low bytes `toBytesLe` would write for it alone: an amount its low 8, a limit its low 16. A
// `minOut` past 64 bits, which its field cannot carry, reverts.

// Raydium CLMM's `swap_v2`: exact input of `amountIn`, `minOut` its least out, `limit` its
// `sqrt_price_limit_x64`. The direction is the accounts'.
export function raydiumClmmData(amountIn: Uint256, limit: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), hex`01`);
}

// PancakeSwap CLMM's, Byreal's and Stabble CLMM's: Raydium's code, Raydium's data.
export function pancakeswapClmmData(amountIn: Uint256, limit: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), hex`01`);
}

export function byrealData(amountIn: Uint256, limit: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), hex`01`);
}

export function stabbleClmmData(amountIn: Uint256, limit: Uint256, minOut: Uint256): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
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
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swapV2 = hex`2b04ed0b1ac91e62`;
  return swapV2.concat(word.toBytesLe(32), aToB ? hex`010100` : hex`010000`);
}

// Cropper's `swap`, a whirlpool's classic one.
export function cropperData(amountIn: Uint256, limit: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
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
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = hex`f8c69e91e17587c8`;
  return swap.concat(word.toBytesLe(32), aToB ? hex`010100` : hex`010000`);
}

// Crema's `swap`: the direction and exact input first, then the amount, its `amount_limit` (the least
// out) and its `sqrt_price_limit`.
export function cremaData(amountIn: Uint256, limit: Uint256, minOut: Uint256, aToB: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const word = (amountIn & 0xffffffffffffffff) | (minOut << 64) | (limit << 128);
  const swap = aToB ? hex`f8c69e91e17587c80101` : hex`f8c69e91e17587c80001`;
  return swap.concat(word.toBytesLe(32));
}

// Invariant's `swap`: the direction (selling X when `xToY`), the amount, exact input and its
// `sqrt_price_limit`. It carries no least out.
export function invariantData(amountIn: Uint256, limit: Uint256, xToY: bool): bytes {
  const swap = xToY ? hex`f8c69e91e17587c801` : hex`f8c69e91e17587c800`;
  const word = (amountIn & 0xffffffffffffffff) | (1 << 64) | (limit << 72);
  return swap.concat(word.toBytesLe(25));
}

// Manifest's `Swap`: exact input of `amountIn`, `minOut` as its least out (`out_atoms`), selling base
// when `paysBase`.
export function manifestData(amountIn: Uint256, minOut: Uint256, paysBase: bool): bytes {
  require(minOut <= 0xffffffffffffffff, "minOut past 64 bits");
  const swap = hex`04`;
  const word =
    (amountIn & 0xffffffffffffffff) | (minOut << 64) | ((paysBase ? 1 : 0) << 128) | (1 << 136);
  return swap.concat(word.toBytesLe(18));
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
// other side unbounded), an immediate-or-cancel order at `priceLots` (0: a market order, at any price,
// whose price the program does not read and requires positive), matching at most `orders` resting
// orders. It carries no least out.
export function openbookV2Data(
  amountIn: Uint256,
  baseLot: Uint256,
  quoteLot: Uint256,
  priceLots: Uint256,
  orders: Uint256,
  paysBase: bool,
): bytes {
  require(priceLots <= 0x7fffffffffffffff && orders <= 255, "limit past its field");
  const most = 0x7fffffffffffffff;
  const baseLots = paysBase ? amountIn / baseLot : most / baseLot;
  const quoteLots = paysBase ? most / quoteLot : amountIn / quoteLot;
  const take = hex`032c47031ac7cb55`;
  const word =
    (paysBase ? 1 : 0) |
    ((priceLots == 0 ? 1 : priceLots) << 8) |
    ((baseLots & 0xffffffffffffffff) << 72) |
    ((quoteLots & 0xffffffffffffffff) << 136) |
    ((priceLots == 0 ? 3 : 1) << 200) |
    (orders << 208);
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
// Each venue's swap at a price: the pool's checks and its own limit for `maxPrice`, then its swap
// with no least out. The caller has required the slot's program to be the venue's and the pool's
// owner, and measures what moved.
// ---------------------------------------------------------------------------------------------

// Raydium CLMM's layout, on its code's four programs. The pool's fee is its `AmmConfig`'s rate.
function swapRaydium(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
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
  const pay = trader[2].address;
  const buy = trader[3].address;
  const own = clmmLimit(
    svm.sload(pool, 73, 32).toBe(),
    svm.sload(pool, 105, 32).toBe(),
    svm.sload(pool, 237, 16).toLe(),
    svm.sload(pool, 253, 16).toLe(),
    svm.sload(slot[2], 47, 4).toLe(),
    pay,
    buy,
    maxPrice,
    amountIn,
  );
  if (own != 0) {
    cpiRaydium(slot, trader, pay < buy, amountIn, own, 0, recipient);
  }
}

// Orca Whirlpools' layout. A pool with an adaptive fee is skipped: its fee rises with volatility,
// past the rate the pool shows.
function swapWhirlpool(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 41, 2).toLe() != svm.sload(pool, 43, 2).toLe()) {
    return;
  }
  const pay = trader[2].address;
  const buy = trader[3].address;
  const own = clmmLimit(
    svm.sload(pool, 101, 32).toBe(),
    svm.sload(pool, 181, 32).toBe(),
    svm.sload(pool, 49, 16).toLe(),
    svm.sload(pool, 65, 16).toLe(),
    svm.sload(pool, 45, 2).toLe(),
    pay,
    buy,
    maxPrice,
    amountIn,
  );
  if (own != 0) {
    cpiWhirlpool(slot, trader, pay < buy, amountIn, own, 0, recipient);
  }
}

// Cropper, a whirlpool's layout; an adaptive fee is skipped, as on Orca.
function swapCropper(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 41, 2).toLe() != svm.sload(pool, 43, 2).toLe()) {
    return;
  }
  const pay = trader[2].address;
  const buy = trader[3].address;
  const own = clmmLimit(
    svm.sload(pool, 101, 32).toBe(),
    svm.sload(pool, 181, 32).toBe(),
    svm.sload(pool, 49, 16).toLe(),
    svm.sload(pool, 65, 16).toLe(),
    svm.sload(pool, 45, 2).toLe(),
    pay,
    buy,
    maxPrice,
    amountIn,
  );
  if (own != 0) {
    cpiCropper(slot, trader, pay < buy, amountIn, own, 0, recipient);
  }
}

// DefiTuna's layout.
function swapDefituna(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  const pay = trader[2].address;
  const buy = trader[3].address;
  const own = clmmLimit(
    svm.sload(pool, 11, 32).toBe(),
    svm.sload(pool, 43, 32).toBe(),
    svm.sload(pool, 151, 16).toLe(),
    svm.sload(pool, 167, 16).toLe(),
    svm.sload(pool, 143, 2).toLe(),
    pay,
    buy,
    maxPrice,
    amountIn,
  );
  if (own != 0) {
    cpiDefituna(slot, trader, pay < buy, amountIn, own, 0, recipient);
  }
}

// Crema's layout; a paused pool is skipped.
function swapCrema(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 747, 1).toLe() != 0) {
    return;
  }
  const pay = trader[2].address;
  const buy = trader[3].address;
  const own = clmmLimit(
    svm.sload(pool, 40, 32).toBe(),
    svm.sload(pool, 72, 32).toBe(),
    svm.sload(pool, 174, 16).toLe(),
    svm.sload(pool, 190, 16).toLe(),
    svm.sload(pool, 172, 2).toLe(),
    pay,
    buy,
    maxPrice,
    amountIn,
  );
  if (own != 0) {
    cpiCrema(slot, trader, pay < buy, amountIn, own, 0, recipient);
  }
}

// Phoenix: an immediate-or-cancel order at the limit price, for every lot of the input. A market not
// open for taking, an input under one lot and a limit past the order's 64-bit price are skipped.
function swapPhoenix(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
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
  // One tick, in maxPrice's units: quote atoms per base atom, times 10^18.
  const tick = Math.mulDiv(
    svm.sload(pool, 840, 8).toLe() * quoteLot,
    10 ** 18,
    svm.sload(pool, 832, 8).toLe() * baseLot,
  );
  // Buying base: the most a base atom may cost before the fee. Selling it: the least it must fetch
  // before the fee is taken, rounded up.
  let ticks = Math.mulDiv(maxPrice, 10000, (10000 + fee) * tick);
  if (paysBase) {
    ticks = Math.mulDiv(10 ** 36, 10000, maxPrice * (10000 - fee) * tick) + 1;
  }
  // Every lot of the input, of the token it pays: base lots selling base, quote lots buying it. The
  // order's price is 64 bits, and a limit past them would be cut to some other price: no order. A
  // limit under one tick, buying, finds no offer either.
  const lot = paysBase ? baseLot : quoteLot;
  if (amountIn < lot || ticks == 0 || ticks > 0xffffffffffffffff) {
    return;
  }
  cpiPhoenix(slot, trader, paysBase, amountIn, lot, ticks, recipient);
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
// Any of the nine venues, read from the pool's owner
// ---------------------------------------------------------------------------------------------

// A pool at any of the nine venues, or nothing: the venue is the program that owns the pool, and a
// pool no venue here owns reverts. The `try` contract above.
export function trySwap(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const venue = pool.owner;
  require(slot[0].address == venue, "a pool's program is not its owner");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  if (
    venue == 0xa5d5ca9e04cf5db590b714ba2fe32cb159133fc1c192b72257fd07d39cb0401e || // Raydium CLMM, CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK
    venue == 0xf9ddcb1fe2f88ebbac5f5b97b4b90ad49551962b89419d765284622845e41cf8 || // PancakeSwap CLMM, HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq
    venue == 0x0634d20f1bf56dd164e3c13c7836a4229ec5ab21ff54528390a51789f3cdbbdb || // Byreal, REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2
    venue == 0x539a8f14242a332eff95ba037c2c3936689d09da4571718f89491b86302586a3 // Stabble CLMM, 6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6
  ) {
    swapRaydium(slot, trader, amountIn, maxPrice, recipient);
  } else if (venue == 0x0e03685f8e909053e458121c66f5a76aedc7706aa11c82f8aa952a8f2b7879a9) {
    // Orca Whirlpools, whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
    swapWhirlpool(slot, trader, amountIn, maxPrice, recipient);
  } else if (venue == 0xefa6e5dfb789ce3db66eccedff9eab02ca6a57cf068746befe835ab4c2f2ee0f) {
    // Cropper, H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt
    swapCropper(slot, trader, amountIn, maxPrice, recipient);
  } else if (venue == 0x09db19e5e1ffb1eba60fcffdafaa314664a12f6cac8af15485b5ddd92b6f3ae6) {
    // DefiTuna, fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9
    swapDefituna(slot, trader, amountIn, maxPrice, recipient);
  } else if (venue == 0xa865993892793f8063d3199efd7fbda5844e3a99b4c73ce660916534b64e4ce6) {
    // Crema, CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR
    swapCrema(slot, trader, amountIn, maxPrice, recipient);
  } else if (venue == 0x05d0ea4f33737013a563e09348edb6f4593d91fc7641f9247c2441a842a1bbeb) {
    // Phoenix, PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY
    swapPhoenix(slot, trader, amountIn, maxPrice, recipient);
  } else {
    throw "not a supported venue's pool";
  }
  // `settled`, written out: the distributed swap calls this once per slot, and the call costs bytes
  // every program that takes `trySwap` carries.
  if (svm.sload(trader[1], 64, 8).toLe() == held) {
    return 0;
  }
  const received = svm.sload(recipient, 64, 8).toLe() - before;
  require(received > 0 && received >= minOut, "below minOut");
  return received;
}

// `trySwap`, or revert.
export function swap(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = trySwap(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// ---------------------------------------------------------------------------------------------
// One venue each
// ---------------------------------------------------------------------------------------------

// Raydium CLMM, CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK.
export function tryRaydiumClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xa5d5ca9e04cf5db590b714ba2fe32cb159133fc1c192b72257fd07d39cb0401e;
  require(owned && slot[0].address == pool.owner, "not a Raydium CLMM pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapRaydium(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function raydiumClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryRaydiumClmm(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// PancakeSwap CLMM, HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq: Raydium's code.
export function tryPancakeswapClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xf9ddcb1fe2f88ebbac5f5b97b4b90ad49551962b89419d765284622845e41cf8;
  require(owned && slot[0].address == pool.owner, "not a PancakeSwap CLMM pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapRaydium(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function pancakeswapClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryPancakeswapClmm(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// Byreal, REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2: Raydium's code, with fees a pool may add.
export function tryByreal(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x0634d20f1bf56dd164e3c13c7836a4229ec5ab21ff54528390a51789f3cdbbdb;
  require(owned && slot[0].address == pool.owner, "not a Byreal pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapRaydium(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function byreal(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryByreal(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// Stabble CLMM, 6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6: Raydium's code.
export function tryStabbleClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x539a8f14242a332eff95ba037c2c3936689d09da4571718f89491b86302586a3;
  require(owned && slot[0].address == pool.owner, "not a Stabble CLMM pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapRaydium(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function stabbleClmm(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryStabbleClmm(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// Orca Whirlpools, whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc.
export function tryOrcaWhirlpool(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x0e03685f8e909053e458121c66f5a76aedc7706aa11c82f8aa952a8f2b7879a9;
  require(owned && slot[0].address == pool.owner, "not an Orca whirlpool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapWhirlpool(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function orcaWhirlpool(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryOrcaWhirlpool(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// Cropper, H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt: Orca's code. It needs every tick array its
// walk reaches to exist.
export function tryCropper(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xefa6e5dfb789ce3db66eccedff9eab02ca6a57cf068746befe835ab4c2f2ee0f;
  require(owned && slot[0].address == pool.owner, "not a Cropper pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapCropper(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function cropper(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryCropper(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// DefiTuna, fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9.
export function tryDefituna(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0x09db19e5e1ffb1eba60fcffdafaa314664a12f6cac8af15485b5ddd92b6f3ae6;
  require(owned && slot[0].address == pool.owner, "not a DefiTuna pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapDefituna(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function defituna(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryDefituna(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// Crema, CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR.
export function tryCrema(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const pool = slot[1];
  if (pool.address == 0 || amountIn == 0) {
    return 0;
  }
  const owned = pool.owner == 0xa865993892793f8063d3199efd7fbda5844e3a99b4c73ce660916534b64e4ce6;
  require(owned && slot[0].address == pool.owner, "not a Crema pool");
  const held = balanceOf(trader[2].address, trader[1]);
  const before = balanceOf(trader[3].address, recipient);
  swapCrema(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function crema(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryCrema(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// Phoenix, PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY. Its checks cannot see the book: an order
// whose book has no offer within the limit runs and fills nothing, and returns 0, having moved nothing.
export function tryPhoenix(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
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
  swapPhoenix(slot, trader, amountIn, maxPrice, recipient);
  return settled(trader[1], recipient, held, before, minOut);
}

export function phoenix(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryPhoenix(slot, trader, amountIn, maxPrice, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
}

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// At a limit in the pool's own terms
// ---------------------------------------------------------------------------------------------
//
// `try…AtLimit` and `…AtLimit` take a slot and the trader like the functions above, and the pool's
// own limit in place of `maxPrice`: no fee is read for it and no root taken, and the instruction is
// the one a caller would build by hand for that limit, `minOut` in the venue's own floor where its
// instruction has one. `…Cpi` is that instruction alone, on the accounts the caller lists in the
// venue's own order: it checks nothing but the program, reads nothing but the paying account, and
// returns what that account paid. Each builds its data with the venue's `…Data`.

// The checks a Raydium-layout pool's `try…AtLimit` makes past its program and owner: swaps on, and
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
export function tryRaydiumClmmAtLimit(
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

export function raydiumClmmAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryRaydiumClmmAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = raydiumClmmData(amountIn, limit, minOut);
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
export function tryPancakeswapClmmAtLimit(
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

export function pancakeswapClmmAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryPancakeswapClmmAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = pancakeswapClmmData(amountIn, limit, minOut);
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
export function tryByrealAtLimit(
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

export function byrealAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryByrealAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = byrealData(amountIn, limit, minOut);
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
export function tryStabbleClmmAtLimit(
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

export function stabbleClmmAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryStabbleClmmAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = stabbleClmmData(amountIn, limit, minOut);
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
// `extra`, which must then be writable.
export function tryOrcaWhirlpoolAtLimit(
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

export function orcaWhirlpoolAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryOrcaWhirlpoolAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  // Eleven accounts are the classic `swap`'s; `swap_v2` takes fifteen.
  const data =
    accounts.length == 11
      ? orcaWhirlpoolData(amountIn, limit, minOut, aToB)
      : orcaWhirlpoolV2Data(amountIn, limit, minOut, aToB);
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
export function tryCropperAtLimit(
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

export function cropperAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryCropperAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = cropperData(amountIn, limit, minOut, aToB);
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
export function tryDefitunaAtLimit(
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

export function defitunaAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryDefitunaAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = defitunaData(amountIn, limit, minOut, aToB);
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
export function tryCremaAtLimit(
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

export function cremaAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryCremaAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = cremaData(amountIn, limit, minOut, aToB);
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
export function tryPhoenixAtLimit(
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

export function phoenixAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  ticks: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryPhoenixAtLimit(slot, trader, amountIn, ticks, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
// X). Its instruction carries no least out: the recipient's balance is held to `minOut`.
export function tryInvariantAtLimit(
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

export function invariantAtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  limit: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryInvariantAtLimit(slot, trader, amountIn, limit, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = invariantData(amountIn, limit, xToY);
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
export function tryManifest(
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

export function manifest(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryManifest(slot, trader, amountIn, minOut, recipient);
  require(received > 0, "nothing swapped");
  return received;
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
  const data = manifestData(amountIn, minOut, paysBase);
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
export function tryOpenbookV2AtLimit(
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

export function openbookV2AtLimit(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  priceLots: Uint256,
  orders: Uint256,
  minOut: Uint256,
  recipient: Account,
): Uint256 {
  const received = tryOpenbookV2AtLimit(
    slot,
    trader,
    amountIn,
    priceLots,
    orders,
    minOut,
    recipient,
  );
  require(received > 0, "nothing swapped");
  return received;
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
  // The market's lot sizes: the market is the instruction's third account.
  const market = accounts[2];
  const data = openbookV2Data(
    amountIn,
    svm.sload(market, 456, 8).toLe(),
    svm.sload(market, 448, 8).toLe(),
    priceLots,
    orders,
    paysBase,
  );
  const held = svm.sload(source, 64, 8).toLe();
  svm.call(program, accounts, data);
  const left = svm.sload(source, 64, 8).toLe();
  if (left >= held) {
    return 0;
  }
  require(held - left <= amountIn, "debit");
  return held - left;
}
