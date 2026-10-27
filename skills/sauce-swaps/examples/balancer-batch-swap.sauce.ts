// Swaps through two Balancer V2 pools in one batch: `tokenIn` for `via` in `firstPool`, then `via`
// for `tokenOut` in `secondPool`. The Vault settles the batch as one trade, so only `tokenIn` leaves
// the Pot, only `tokenOut` arrives, and `via` never passes through the Pot. Given in (`givenOut`
// false) sells exactly `amount` and takes at least `limit`; given out (`givenOut` true) buys exactly
// `amount` and pays at most `limit`. The Vault's own queryBatchSwap prices the same steps first, and
// the program refuses a quote past `limit` before anything moves; the same bound goes to batchSwap
// as its signed limits, so the Vault holds the trade to it as well. The Vault is approved for the
// most the batch may take, and what it leaves is reset to zero. queryBatchSwap is not in the
// registry's Vault ABI: BalancerV2Query.json beside this file declares it. Returns what the Pot
// paid and what the recipient received, each measured as a balance change.
//
//   sauce run balancer-batch-swap.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <givenOut> <firstPool> <secondPool> <tokenIn> <via> <tokenOut> <amount> <limit> <recipient>
//
//   givenOut: bool       false sells exactly `amount` of tokenIn; true buys exactly `amount` of
//                        tokenOut
//   firstPool: Uint256   the Balancer pool id (its bytes32, written as a number) of the pool that
//                        trades tokenIn for via
//   secondPool: Uint256  the pool id of the pool that trades via for tokenOut
//   tokenIn: Address     the token the Pot pays
//   via: Address         the token between the two pools
//   tokenOut: Address    the token bought
//   amount: Uint256      given in, the tokenIn sold; given out, the tokenOut bought; in that token's
//                        smallest units: 1000000000 is 1,000 USDC (6 decimals)
//   limit: Uint256       given in, the least tokenOut to accept; given out, the most tokenIn to pay;
//                        in that token's smallest units: 900000 is 0.009 WBTC (8 decimals)
//   recipient: Address   who receives tokenOut
//
// On Ethereum, 1,000 USDC sold for WBTC (`<wbtc>`, its address) through WETH, in Balancer's 50/50
// USDC/WETH and WBTC/WETH pools, for at least 0.009 WBTC:
//
//   sauce run balancer-batch-swap.sauce.ts --chain ethereum --keystore <keystore> \
//     --args false 0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019 \
//     0xa6f548df93de924d73be7d25dc02554c6bd66db500020000000000000000000e \
//     0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
//     <wbtc> 1000000000 900000 <recipient>
import BalancerV2Query from "./BalancerV2Query.json";

function main(
  givenOut: bool,
  firstPool: Uint256,
  secondPool: Uint256,
  tokenIn: Address,
  via: Address,
  tokenOut: Address,
  amount: Uint256,
  limit: Uint256,
  recipient: Address,
): { paid: Uint256; received: Uint256 } {
  const assets = [tokenIn, via, tokenOut];
  const funds = { sender: pot, fromInternalBalance: false, recipient, toInternalBalance: false };

  // Given in, the steps run pool by pool, and the second step's amount of 0 sells all the first
  // one bought. Given out, they run from the last pool back: the first step buys `amount`, and the
  // second's 0 buys exactly the `via` the first one needs.
  let kind = 0;
  let maxIn = amount;
  let minOut = limit;
  let swaps = [
    { poolId: firstPool, assetInIndex: 0, assetOutIndex: 1, amount, userData: hex`` },
    { poolId: secondPool, assetInIndex: 1, assetOutIndex: 2, amount: 0, userData: hex`` },
  ];
  if (givenOut) {
    kind = 1;
    maxIn = limit;
    minOut = amount;
    swaps = [
      { poolId: secondPool, assetInIndex: 1, assetOutIndex: 2, amount, userData: hex`` },
      { poolId: firstPool, assetInIndex: 0, assetOutIndex: 1, amount: 0, userData: hex`` },
    ];
  }

  // The Vault's price for these steps now, per asset: what the Pot pays is positive, what the
  // recipient receives negative, and `via` nets to zero.
  const quoted = BalancerV2Query.at(BalancerV2.Vault).queryBatchSwap(kind, swaps, assets, funds);
  require(quoted[0] <= Int256(maxIn), "the pools want more tokenIn than the limit");
  require(-quoted[2] >= Int256(minOut), "the pools give less tokenOut than the limit");

  const inBefore = Token(tokenIn).balanceOf(pot);
  require(inBefore >= maxIn, "the Pot does not hold the tokenIn the batch may take");
  const outBefore = Token(tokenOut).balanceOf(recipient);

  // The same bounds as the Vault's signed limits: at most maxIn paid, nothing of via, and at
  // least minOut received.
  const none: Int256 = 0;
  Token(tokenIn).approve(BalancerV2.Vault, maxIn);
  BalancerV2.Vault.batchSwap(
    kind,
    swaps,
    assets,
    funds,
    [Int256(maxIn), none, -Int256(minOut)],
    ctx.timestamp(),
  );

  const paid = inBefore - Token(tokenIn).balanceOf(pot);
  if (paid < maxIn) Token(tokenIn).approve(BalancerV2.Vault, 0);
  return { paid, received: Token(tokenOut).balanceOf(recipient) - outBefore };
}
