// @sauce/router — SVM arm. One function per Solana venue whose swap takes a price limit.
//
// Every function here is a LIMIT ORDER at one pool: it offers the pool up to `amountIn` of the token
// paid and lets the pool trade until its price, fee included, reaches `maxPrice`; the pool takes only
// what it swapped before that and leaves the rest in the paying account, so nothing is stranded.
// Every function takes RUN-TIME arguments and returns the amount the recipient received, measured
// from its token balance. The arguments come in one order for every venue:
//
//   venue(slot, trader, amountIn, maxPrice, minOut, recipient)
//
// `slot` is the pool's nine accounts, in this order (an account a venue does not take is the System
// program, `11111111111111111111111111111111`):
//
//   0 program   the venue's program, which must own the pool
//   1 pool      the pool (a market, on Phoenix)
//   2 config    the account the venue keeps the pool's settings in, where it has one
//   3 vaultA    the pool's vault for its first token (token 0, token A, Phoenix's base)
//   4 vaultB    the pool's vault for its second token
//   5 extra     one more account the venue's swap takes
//   6–8 ticks   the three tick arrays the swap walks, in walk order
//
// `trader` is the accounts every swap shares: the authority that signs for the paying account (the
// Pot, through the Kitchen), the paying token account (`source`), the two mints (`payMint`, then
// `buyMint`), the SPL Token and Token-2022 programs and the memo program, in that order. `recipient`
// is the token account the output lands in; Crema and Phoenix pay only into the authority's own.
// `amountIn` is in the paid token's base units. `maxPrice` is the most one unit bought may cost, fee
// included, as payToken base units per buyToken base unit times 1e18. `minOut` is the least the
// recipient may receive from a swap that ran; below it the whole program reverts. Every swap is
// EXACT INPUT up to the limit: nothing here can express an exact-output swap.
//
// THE LIMIT. A concentrated-liquidity pool's price is a Q64.64 square root of the higher-key token
// per lower-key token (the pair in the order of the mints' 32-byte keys), and it takes its fee from
// the input, so its last unit costs its price divided by `1 − fee`. Each function reads the pool's
// fee and moves `maxPrice`'s square root toward the trade by `√(1 − fee)`: the pool's last unit, fee
// paid, then costs at most `maxPrice`, and every earlier unit less. A Phoenix market charges its taker
// fee on top, so its limit price is `maxPrice ÷ (1 + fee)`, in the market's ticks.
//
// WHICH VENUE. A pool is an account of its venue's program, so `pool.owner` says how to read and swap
// it. `trySwap` and `swap` take a pool at any of the nine venues and read its venue from its owner;
// the per-venue functions take one venue's pools and refuse any other. Each requires the slot's
// program to be the venue's and the pool's owner before it reads a byte of the pool: the authority
// signs the swap, so the program it calls must be the venue's own. Raydium CLMM, PancakeSwap CLMM,
// Byreal and Stabble CLMM run one program code and share one pool layout and one swap; Cropper runs
// Orca's, with only its first swap.
//
// TRY FORMS. A failed call into another program aborts the whole Solana transaction and cannot be
// caught, so a Solana `try` form checks before anything moves: it returns 0 having moved nothing for
// a missing slot (the System program as its pool), no input, a pool whose swaps are switched off, a
// paused pool or a market not open for taking, a fee that is more than one rate (a dynamic or
// adaptive fee, or a Byreal pool's own), a pool with no liquidity at its price, a pool already at or
// past its own limit, and an input smaller than one of a market's lots. A swap that ran returns at
// least 1: it is held to the floor afterwards — `minOut`, and at least 1 — and reverts below it, so
// `0` always means skipped. An input too small to buy anything (an atom) is below that floor where
// Orca's code takes it and gives nothing back. A swap that ran and moved nothing either way is a
// skip too: a Phoenix order whose book has no offer within the limit fills nothing, which only the
// paying account's balance tells. A failure the checks do not foresee still aborts the transaction:
// a tick array missing from the slot, or an input Raydium's code finds too small to swap. A slot
// that is not the pair, or whose program is not the venue's or not the pool's owner, reverts: those
// are the caller's accounts, not the pool's state.
//
// The plain forms swap or revert: each is its `try` form, reverting where that returns 0.
//
// Every venue's swap is its own instruction, called with `svm.call`. Token reads are
// `@sauce/token`'s, so either token program's accounts work.
//
// Each venue's code is its own internal function, and the functions a program calls are the only
// ones compiled into it: a program swapping at one venue carries that venue's code alone.
//
// No module-level `const` here: a compile-time define replaces a same-named `const` in every module,
// this one included.
import { balanceOf } from "@sauce/token";

// ---------------------------------------------------------------------------------------------
// The concentrated-liquidity order
// ---------------------------------------------------------------------------------------------

// What a concentrated-liquidity pool's swap carries, as every venue here lays it out: the amount in,
// no minimum output of its own, and the pool's own limit as a Q64.64 sqrt price — 32 bytes, empty
// when the pool has nothing to sell within the limit (no liquidity at its price, or its price already
// at or past the limit). Requires the pool's two mints, in key order, to be the pair. `fee` is in
// millionths, taken from the input.
function clmmOrder(
  mintA: Uint256,
  mintB: Uint256,
  liquidity: Uint256,
  price: Uint256,
  fee: Uint256,
  pay: Uint256,
  buy: Uint256,
  maxPrice: Uint256,
  amountIn: Uint256,
): bytes {
  const paysA = pay < buy;
  require(mintA == (paysA ? pay : buy) && mintB == (paysA ? buy : pay), "pool is not the pair");
  // maxPrice as a sqrt price: the higher-key token per lower-key token, times 2^64. Paying the
  // lower-key token it is upside down.
  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1 << 128, 10 ** 18));
  if (paysA) {
    limit = Math.sqrt(Math.mulDiv(1 << 128, 10 ** 18, maxPrice));
  }
  // Moved by √(1 − fee), so that the pool's last unit, fee paid, costs exactly maxPrice. Paying the
  // lower-key token pushes the price down, the other up. The root is rounded down, so the limit sits
  // a hair inside the exact one: the pool stops a little sooner, never later.
  const root = Math.sqrt((1000000 - fee) * 10 ** 30); // √(1 − fee), times 1e18
  const own = paysA ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);
  const better = paysA ? price > own : price < own;
  if (liquidity == 0 || !better) {
    return hex``;
  }
  const none = hex`0000000000000000`;
  return amountIn.toBytesLe(8).concat(none, own.toBytesLe(16));
}

// ---------------------------------------------------------------------------------------------
// Each venue's swap: the pool's checks, then its instruction. The caller has required the slot's
// program to be the venue's and the pool's owner, and measures what moved.
// ---------------------------------------------------------------------------------------------

// Raydium CLMM, and PancakeSwap CLMM, Byreal and Stabble CLMM on its code: `swap_v2`. The slot's
// `config` is the pool's `AmmConfig` (its fee rate at 47), `extra` its observation account.
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
  const payMint = trader[2];
  const buyMint = trader[3];
  const buy = buyMint.address;
  const order = clmmOrder(
    svm.sload(pool, 73, 32).toBe(),
    svm.sload(pool, 105, 32).toBe(),
    svm.sload(pool, 237, 16).toLe(),
    svm.sload(pool, 253, 16).toLe(),
    svm.sload(slot[2], 47, 4).toLe(),
    payMint.address,
    buy,
    maxPrice,
    amountIn,
  );
  if (order.length == 0) {
    return;
  }
  // The input and output vault, token program, Token-2022 and the memo program, both mints, then the
  // tick arrays.
  const paysA = payMint.address < buy;
  const swapV2 = hex`2b04ed0b1ac91e62`;
  const data = swapV2.concat(order, hex`01`);
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
      payMint,
      buyMint,
      slot[6],
      slot[7],
      slot[8],
    ],
    data,
  );
}

// Orca Whirlpools: `swap_v2`. The slot's `config` is unused, `extra` the pool's oracle. Token A's
// accounts come first whatever the direction, which is "A to B", true paying the lower-key token.
function swapWhirlpool(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 41, 2).toLe() != svm.sload(pool, 43, 2).toLe()) {
    return; // an adaptive fee: it rises with volatility, past the rate the pool shows
  }
  const payMint = trader[2];
  const buyMint = trader[3];
  const buy = buyMint.address;
  const order = clmmOrder(
    svm.sload(pool, 101, 32).toBe(),
    svm.sload(pool, 181, 32).toBe(),
    svm.sload(pool, 49, 16).toLe(),
    svm.sload(pool, 65, 16).toLe(),
    svm.sload(pool, 45, 2).toLe(),
    payMint.address,
    buy,
    maxPrice,
    amountIn,
  );
  if (order.length == 0) {
    return;
  }
  const paysA = payMint.address < buy;
  const source = trader[1];
  const mintA = paysA ? payMint : buyMint;
  const mintB = paysA ? buyMint : payMint;
  const swapV2 = hex`2b04ed0b1ac91e62`;
  const data = swapV2.concat(order, hex`01`, paysA ? hex`01` : hex`00`, hex`00`);
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
      paysA ? source : recipient,
      slot[3],
      paysA ? recipient : source,
      slot[4],
      slot[6],
      slot[7],
      slot[8],
      slot[5],
    ],
    data,
  );
}

// Cropper, on Orca's code with only its first `swap`, and no Token-2022: the whirlpool's layout,
// its accounts without the mints and the memo program.
function swapCropper(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 41, 2).toLe() != svm.sload(pool, 43, 2).toLe()) {
    return; // an adaptive fee
  }
  const pay = trader[2].address;
  const buy = trader[3].address;
  const order = clmmOrder(
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
  if (order.length == 0) {
    return;
  }
  const paysA = pay < buy;
  const source = trader[1];
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(order, hex`01`, paysA ? hex`01` : hex`00`);
  svm.call(
    slot[0],
    [
      trader[4],
      trader[0],
      pool,
      paysA ? source : recipient,
      slot[3],
      paysA ? recipient : source,
      slot[4],
      slot[6],
      slot[7],
      slot[8],
      slot[5],
    ],
    data,
  );
}

// DefiTuna: its `swap`, a whirlpool's fields in another order. The slot's `config` and `extra` are
// unused. Its pools hold resting limit orders too, which a swap fills at their tick's price: within
// the limit, like the rest.
function swapDefituna(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  const payMint = trader[2];
  const buyMint = trader[3];
  const buy = buyMint.address;
  const order = clmmOrder(
    svm.sload(pool, 11, 32).toBe(),
    svm.sload(pool, 43, 32).toBe(),
    svm.sload(pool, 151, 16).toLe(),
    svm.sload(pool, 167, 16).toLe(),
    svm.sload(pool, 143, 2).toLe(),
    payMint.address,
    buy,
    maxPrice,
    amountIn,
  );
  if (order.length == 0) {
    return;
  }
  const paysA = payMint.address < buy;
  const source = trader[1];
  const mintA = paysA ? payMint : buyMint;
  const mintB = paysA ? buyMint : payMint;
  const swap = hex`f8c69e91e17587c8`;
  const data = swap.concat(order, hex`01`, paysA ? hex`01` : hex`00`, hex`00`);
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
      paysA ? source : recipient,
      paysA ? recipient : source,
      slot[3],
      slot[4],
      slot[6],
      slot[7],
      slot[8],
    ],
    data,
  );
}

// Crema: its `swap`. The slot's `config` is the pool's `clmm_config`, `extra` its tick-array map.
function swapCrema(
  slot: Account[],
  trader: Account[],
  amountIn: Uint256,
  maxPrice: Uint256,
  recipient: Account,
): void {
  const pool = slot[1];
  if (svm.sload(pool, 747, 1).toLe() != 0) {
    return; // paused
  }
  const payMint = trader[2];
  const buyMint = trader[3];
  const buy = buyMint.address;
  const order = clmmOrder(
    svm.sload(pool, 40, 32).toBe(),
    svm.sload(pool, 72, 32).toBe(),
    svm.sload(pool, 174, 16).toLe(),
    svm.sload(pool, 190, 16).toLe(),
    svm.sload(pool, 172, 2).toLe(),
    payMint.address,
    buy,
    maxPrice,
    amountIn,
  );
  if (order.length == 0) {
    return;
  }
  const paysA = payMint.address < buy;
  const source = trader[1];
  const swap = hex`f8c69e91e17587c8`;
  const aToB = paysA ? hex`01` : hex`00`;
  const data = swap.concat(aToB, hex`01`, order);
  svm.call(
    slot[0],
    [
      slot[2],
      pool,
      paysA ? payMint : buyMint,
      paysA ? buyMint : payMint,
      paysA ? source : recipient,
      paysA ? recipient : source,
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

// Phoenix, an order book: an immediate-or-cancel order at the limit price, for every lot of the
// input. It takes every offer at or better than the limit, leaves the rest on the book, and fills
// nothing when the best offer is past the limit. The slot's `config` is the log authority; base and
// quote are not in key order, so which one is paid is read from the market.
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
  let side = hex`000200`;
  if (paysBase) {
    ticks = Math.mulDiv(10 ** 36, 10000, maxPrice * (10000 - fee) * tick) + 1;
    side = hex`000201`;
  }
  // Every lot of the input, of the token it pays: base lots selling base, quote lots buying it.
  const lots = amountIn / (paysBase ? baseLot : quoteLot);
  if (lots == 0) {
    return;
  }
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
  const source = trader[1];
  svm.call(
    slot[0],
    [
      slot[0],
      slot[2],
      pool,
      trader[0],
      paysBase ? source : recipient,
      paysBase ? recipient : source,
      slot[3],
      slot[4],
      trader[4],
    ],
    order.concat(rest),
  );
}

// What a swap moved: 0 when the paying account paid nothing (`held` is its balance before), else
// what the recipient received over `before`, held to the floor — `minOut`, and at least 1.
function settled(
  trader: Account[],
  recipient: Account,
  held: Uint256,
  before: Uint256,
  minOut: Uint256,
): Uint256 {
  if (balanceOf(trader[2].address, trader[1]) == held) {
    return 0;
  }
  const received = balanceOf(trader[3].address, recipient) - before;
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
  return settled(trader, recipient, held, before, minOut);
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
