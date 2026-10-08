// Distributed swap: sell 500 USDC for SOL (minimum 4.2 SOL) across 4 venues with price limit
// sauce simulate sauce/distributed_swap.sauce.ts --chain solana --owner <owner> \
//   --accounts <accounts.json> --assume-balance USDC:500 WSOL:0 \
//   --args "500000000" "116000000000000000" "4200000000" "116000000000000000"
//
// budget: Uint256, max USDC to spend in base units (6 decimals; 500000000 = 500 USDC)
// maxPrice: Uint256, max USDC per SOL in wei units (116000000000000000 ≈ 0.116 USDC per lamport)
// minTokens: Uint256, minimum WSOL to receive in base units (9 decimals; 4200000000 = 4.2 SOL)
// maxAvgPrice: Uint256, optional average price cap (0 to disable)
//
// Example on Solana mainnet: 500 USDC → 4.2 SOL minimum at 0.116 USDC per SOL price limit

// @chain solana

// Venue program IDs (as Addresses for comparison)
const ORCA_WHIRLPOOL = 0x0e03685f8e909053e458121c66f5a76aedc7706aa11c82f8aa952a8f2b7879a9; // whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
const PANCAKESWAP_CLMM = 0xf9ddcb1fe2f88ebbac5f5b97b4b90ad49551962b89419d765284622845e41cf8; // HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq
const SYSTEM_PROGRAM = 0x0; // 11111111111111111111111111111111

// Simplified trade function for one pool slot
function trade(
  slot: Account[],
  shared: Account[],
  kept: Uint256,
  limit: Uint256
): void {
  const program = slot[0];
  const pool = slot[1];
  const config = slot[2];
  const vaultA = slot[3];
  const vaultB = slot[4];
  const extra = slot[5];
  const ticks0 = slot[6];
  const ticks1 = slot[7];
  const ticks2 = slot[8];

  const authority = shared[0];
  const source = shared[1];
  const output = shared[2];
  const payMint = shared[3];
  const buyMint = shared[4];
  const tokenProgram = shared[5];
  const token2022 = shared[6];

  // Skip empty slots (system program)
  if (program.address == SYSTEM_PROGRAM) {
    return;
  }

  const unspent = balanceOf(payMint.address, source) - kept;
  if (unspent == 0) {
    return;
  }

  // Determine venue and call appropriate swap using svm.call
  const venue = program.address;
  if (venue == ORCA_WHIRLPOOL) {
    // Orca Whirlpools swap_v2 instruction
    const swapV2 = hex`2b04ed0b1ac91e62`;
    const amount = unspent.toBytesLe(8);
    const none = hex`0000000000000000`;
    const bound = limit.toBytesLe(16);
    const data = swapV2.concat(amount, none, bound, hex`01`, hex`01`, hex`00`);
    svm.call(
      program,
      [tokenProgram, token2022, program, authority, pool, payMint, buyMint, source, vaultA, output, vaultB, ticks0, ticks1, ticks2, extra],
      data
    );
  } else if (venue == PANCAKESWAP_CLMM) {
    // PancakeSwap CLMM swap_v2 instruction
    const swapV2 = hex`2b04ed0b1ac91e62`;
    const amount = unspent.toBytesLe(8);
    const none = hex`0000000000000000`;
    const bound = limit.toBytesLe(16);
    const data = swapV2.concat(amount, none, bound, hex`01`, hex`01`, hex`00`);
    svm.call(
      program,
      [tokenProgram, token2022, program, authority, pool, payMint, buyMint, source, vaultA, output, vaultB, ticks0, ticks1, ticks2, extra],
      data
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
  s0p: Account,
  s0pool: Account<Writable>,
  s0config: Account,
  s0va: Account<Writable>,
  s0vb: Account<Writable>,
  s0ex: Account<Writable>,
  s0t0: Account<Writable>,
  s0t1: Account<Writable>,
  s0t2: Account<Writable>,
  s1p: Account,
  s1pool: Account<Writable>,
  s1config: Account,
  s1va: Account<Writable>,
  s1vb: Account<Writable>,
  s1ex: Account<Writable>,
  s1t0: Account<Writable>,
  s1t1: Account<Writable>,
  s1t2: Account<Writable>,
  s2p: Account,
  s2pool: Account<Writable>,
  s2config: Account,
  s2va: Account<Writable>,
  s2vb: Account<Writable>,
  s2ex: Account<Writable>,
  s2t0: Account<Writable>,
  s2t1: Account<Writable>,
  s2t2: Account<Writable>,
  s3p: Account,
  s3pool: Account<Writable>,
  s3config: Account,
  s3va: Account<Writable>,
  s3vb: Account<Writable>,
  s3ex: Account<Writable>,
  s3t0: Account<Writable>,
  s3t1: Account<Writable>,
  s3t2: Account<Writable>,
  budget: Uint256,
  maxPrice: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  const pay = payMint.address;
  const buy = buyMint.address;

  // Verify preconditions
  require(maxPrice > 0, "maxPrice is 0");
  require(ownerOf(pay, source) == authority.address, "source is not the authority's");
  require(ownerOf(buy, output) == authority.address, "output is not the authority's");
  require(balanceOf(pay, source) >= budget, "budget is not in source");

  const kept = balanceOf(pay, source) - budget; // the account's other payToken, never spent
  const before = balanceOf(buy, output);

  // Calculate adjusted price limit per pool (simplified)
  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1 << 128, 10 ** 18));
  if (pay < buy) {
    limit = Math.sqrt(Math.mulDiv(1 << 128, 10 ** 18, maxPrice));
  }

  // Execute swaps across all 4 slots
  const shared = [authority, source, output, payMint, buyMint, tokenProgram, token2022];
  trade([s0p, s0pool, s0config, s0va, s0vb, s0ex, s0t0, s0t1, s0t2], shared, kept, limit);
  trade([s1p, s1pool, s1config, s1va, s1vb, s1ex, s1t0, s1t1, s1t2], shared, kept, limit);
  trade([s2p, s2pool, s2config, s2va, s2vb, s2ex, s2t0, s2t1, s2t2], shared, kept, limit);
  trade([s3p, s3pool, s3config, s3va, s3vb, s3ex, s3t0, s3t1, s3t2], shared, kept, limit);

  // Settle: what was bought goes to the recipient, what is left of the budget back
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

  return {
    spent: spent,
    bought: bought,
    unspent: unspent
  };
}
