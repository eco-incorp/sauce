// A flash cycle through two Balancer V2 pools of the same pair, in one batch: sells `amount` of
// `token` for `quote` in `sellPool`, then buys `token` back with all of that `quote` in `buyPool`.
// The Vault settles a batch by its net amounts, so the second pool pays for the first and the Pot
// sends nothing: it holds no `token` for the trade and approves nothing. Its limits are zero for
// both tokens, so a cycle that would end with less `token` than it sold reverts in the Vault with
// BAL#507 (the swap limit), having moved nothing. What `buyPool` pays back over `amount` is the
// profit, paid to `recipient`, and the program requires at least `minProfit` of it. Returns the
// profit, measured at the recipient.
//
//   sauce run balancer-flash-cycle.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <sellPool> <buyPool> <token> <quote> <amount> <minProfit> <recipient>
//
//   sellPool: Uint256   the Balancer pool id (its bytes32, written as a number) of the pool where
//                       `token` is dear, which buys it
//   buyPool: Uint256    the pool id of the pool where `token` is cheap, which sells it back
//   token: Address      the token the cycle starts and ends in
//   quote: Address      the token the two pools price it in
//   amount: Uint256     the `token` sold to `sellPool`, in its smallest units:
//                       1000000000000000000 is 1 WETH (18 decimals)
//   minProfit: Uint256  the least `token` the cycle must earn, in the same units:
//                       10000000000000000 is 0.01 WETH
//   recipient: Address  who receives the profit
//
// On Ethereum, 1 WETH sold for USDC in a pool where it is dear and bought back in Balancer's 50/50
// USDC/WETH pool, for at least 0.01 WETH of profit:
//
//   sauce run balancer-flash-cycle.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <sellPool> 0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019 \
//     0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
//     1000000000000000000 10000000000000000 <recipient>
function main(
  sellPool: Uint256,
  buyPool: Uint256,
  token: Address,
  quote: Address,
  amount: Uint256,
  minProfit: Uint256,
  recipient: Address,
): Uint256 {
  const before = Token(token).balanceOf(recipient);
  const none: Int256 = 0;
  BalancerV2.Vault.batchSwap(
    0, // given in: the first step sells exactly `amount`
    [
      { poolId: sellPool, assetInIndex: 0, assetOutIndex: 1, amount, userData: hex`` },
      // An amount of 0 spends all the `quote` the step before bought.
      { poolId: buyPool, assetInIndex: 1, assetOutIndex: 0, amount: 0, userData: hex`` },
    ],
    [token, quote],
    { sender: pot, fromInternalBalance: false, recipient, toInternalBalance: false },
    [none, none], // the Pot pays in nothing of either token
    ctx.timestamp(),
  );
  const profit = Token(token).balanceOf(recipient) - before;
  require(profit >= minProfit, "the cycle earns less than minProfit");
  return profit;
}
