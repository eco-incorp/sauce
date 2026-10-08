// Sells up to 500 USDC for SOL across Solana's price-limited pools, one pool per venue, never
// receiving less than 0.0084 SOL per USDC on any unit, fees included; refunds what does not fill.
//
//   sauce run sell-usdc-for-sol.sauce.ts --chain solana --keypair <keypair> \
//     --accounts accounts.json --args <budget> <maxPrice> <minTokens> <maxAvgPrice>
//
// The accounts, by name, in one JSON object (accounts.json beside this file):
//   authority     pot: the Pot, which signs for its accounts
//   source        pot:USDC: the Pot's USDC account the budget is in
//   output        pot:WSOL: the Pot's WSOL account the SOL bought arrives in
//   recipient     where the SOL bought goes on to (pot:WSOL keeps it in the Pot)
//   refund        where the unfilled USDC goes (pot:USDC keeps it in the Pot)
//   payMint       mint:USDC; buyMint, mint:WSOL
//   tokenProgram  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, and token2022,
//                 TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb, and memo,
//                 MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
//   program<k> pool<k> config<k> vaultA<k> vaultB<k> extra<k> ticks<k>0 ticks<k>1 ticks<k>2
//                 slot k, 0 to 4: a pool's slot paying USDC, as sauce pools gives it, the deepest
//                 first; a slot with no pool is the System program, 11111111111111111111111111111111,
//                 in all nine
//
//   budget: Uint256       the most USDC to sell, in base units (6 decimals): 500000000 is 500 USDC
//   maxPrice: Uint256     the most one SOL may cost, fees included, in USDC base units per lamport
//                         times 1e18: 10^15 ÷ the floor in SOL per USDC (0.0084 → 119047619047619047)
//   minTokens: Uint256    the least SOL to receive, in lamports (9 decimals); less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in maxPrice's units; 0 turns it off
//
//   Sell all of 500 USDC or nothing, at no less than 0.0084 SOL per USDC, rehearsed with no key:
//   sauce simulate sell-usdc-for-sol.sauce.ts --chain solana --owner <owner> \
//     --accounts accounts.json --assume-balance USDC:500 \
//     --args 500000000 119047619047619047 4200000001 118355333918256049

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
  program4: Account,
  pool4: Account<Writable>,
  config4: Account,
  vaultA4: Account<Writable>,
  vaultB4: Account<Writable>,
  extra4: Account<Writable>,
  ticks40: Account<Writable>,
  ticks41: Account<Writable>,
  ticks42: Account<Writable>,
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
  trade(
    [program4, pool4, config4, vaultA4, vaultB4, extra4, ticks40, ticks41, ticks42],
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
