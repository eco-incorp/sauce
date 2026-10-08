// Distributed swap on Solana: sell 500 USDC for SOL across 4 price-limited venues, at most 119 USDC per SOL
// sauce run solana-distributed-swap-demo.sauce.ts --chain solana --keypair <keypair>
// --accounts accounts.json --args 500000000 119050000000000000 4000000000 119000000000000000
//
// budget: Uint256 — 500,000,000 base units = 500 USDC (6 decimals)
// maxPrice: Uint256 — 119,050,000,000,000,000 = max 119.05 USDC per SOL (pay base units per buy, times 1e18)
// minTokens: Uint256 — 4,000,000,000 base units = 4 SOL minimum (9 decimals)
// maxAvgPrice: Uint256 — 119,000,000,000,000,000 = average not above 119 USDC per SOL
//
// Example run: Sell 500 USDC for SOL at most 119 USDC/SOL, expecting at least 4 SOL

const RAYDIUM_CLMM = 0xa5d5ca9e04cf5db590b714ba2fe32cb159133fc1c192b72257fd07d39cb0401e;
const PANCAKESWAP_CLMM = 0xf9ddcb1fe2f88ebbac5f5b97b4b90ad49551962b89419d765284622845e41cf8;
const ORCA_WHIRLPOOL = 0x0e03685f8e909053e458121c66f5a76aedc7706aa11c82f8aa952a8f2b7879a9;

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

  // Concentrated-liquidity venues: pair in key order, price as Q64.64 sqrt, fee in millionths
  const paysA = pay < buy;
  let mintA = 0;
  let mintB = 0;
  let liquidity = 0;
  let price = 0;
  let fee = 0;
  if (venue == RAYDIUM_CLMM || venue == PANCAKESWAP_CLMM) {
    const status = svm.sload(pool, 389, 1).toLe();
    if ((status & 16) != 0 || svm.sload(pool, 393, 4).toLe() != 0) {
      return;
    }
    mintA = svm.sload(pool, 73, 32).toBe();
    mintB = svm.sload(pool, 105, 32).toBe();
    liquidity = svm.sload(pool, 237, 16).toLe();
    price = svm.sload(pool, 253, 16).toLe();
    fee = svm.sload(slot[2], 47, 4).toLe();
  } else if (venue == ORCA_WHIRLPOOL) {
    if (svm.sload(pool, 41, 2).toLe() != svm.sload(pool, 43, 2).toLe()) {
      return;
    }
    mintA = svm.sload(pool, 101, 32).toBe();
    mintB = svm.sload(pool, 181, 32).toBe();
    liquidity = svm.sload(pool, 49, 16).toLe();
    price = svm.sload(pool, 65, 16).toLe();
    fee = svm.sload(pool, 45, 2).toLe();
  } else {
    return;
  }

  require(mintA == (paysA ? pay : buy) && mintB == (paysA ? buy : pay), "pool is not the pair");

  const root = Math.sqrt((1000000 - fee) * 10 ** 30);
  const own = paysA ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);
  const better = paysA ? price > own : price < own;
  if (liquidity == 0 || !better) {
    return;
  }

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
  } else {
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
  const kept = balanceOf(pay, source) - budget;
  const before = balanceOf(buy, output);

  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1 << 128, 10 ** 18));
  if (pay < buy) {
    limit = Math.sqrt(Math.mulDiv(1 << 128, 10 ** 18, maxPrice));
  }

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
