// Balancer's flash swap, ported: when two Balancer pools price the same two tokens apart, one
// `batchSwap` sells `amount` of A to the first pool for B and sells all that B back to the second
// for A. The Vault settles the batch as a whole, so the Pot sends nothing: its limits are zero, and
// the A the second pool pays beyond `amount` goes to `recipient`. A cycle that would cost anything
// fails on those limits and reverts. It returns the profit.
//
// Ported from balancer/docs, docs/reference/swaps/flash-swaps.md (30 lines, 30 of code):
// https://github.com/balancer/docs/blob/bc51cd265e21152ff22e59c7ffac50d3529db25c/docs/reference/swaps/flash-swaps.md
//
// What changes in Sauce: nothing in how it works. A Balancer flash swap is the one flash loan with
// no callback: the Vault nets the steps before anyone pays, so the Pot needs no tokens and no
// Router. The guide shows the transaction's arguments, which the program builds; its count is that
// transaction's code.
//
//   sauce run balancer-v2-flash-swap.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <sellPool> <buyPool> <a> <b> <amount> <recipient>
//
//   sellPool: Uint256    the id of the pool A is sold to, where A is dear
//   buyPool: Uint256     the id of the pool A is bought back from, where A is cheap
//   a: Address           the token the cycle starts and ends with
//   b: Address           the token between
//   amount: Uint256      the A sold to the first pool, in its smallest units:
//                        1000000000000000000 is 1 WETH (18 decimals)
//   recipient: Address   who receives the profit, in A
//
// On Ethereum, 1 WETH around two pools of WETH and USDC, one of them Balancer's 50/50 pool:
//
//   sauce run balancer-v2-flash-swap.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <sellPool> 0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019 \
//     0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
//     1000000000000000000 <recipient>

const GIVEN_IN = 0;

function main(
  sellPool: Uint256,
  buyPool: Uint256,
  a: Address,
  b: Address,
  amount: Uint256,
  recipient: Address,
): Uint256 {
  require(BalancerV2.Vault);
  const swaps = [
    { poolId: sellPool, assetInIndex: 0, assetOutIndex: 1, amount, userData: hex`` },
    // An amount of 0 is the step before's whole output.
    { poolId: buyPool, assetInIndex: 1, assetOutIndex: 0, amount: 0, userData: hex`` },
  ];
  const funds = {
    sender: pot,
    fromInternalBalance: false,
    recipient,
    toInternalBalance: false,
  };
  // Zero limits: the Vault may take nothing of either token from the Pot.
  const deltas = BalancerV2.Vault.batchSwap(
    GIVEN_IN,
    swaps,
    [a, b],
    funds,
    [0, 0],
    ctx.timestamp(),
  );
  return -deltas[0];
}
