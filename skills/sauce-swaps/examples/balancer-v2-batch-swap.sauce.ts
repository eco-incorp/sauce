// Balancer's batch swap examples, ported: Balancer's batch swap guide routes token A to token C
// through B, across two pools, in one call to the Vault's `batchSwap`: "given in" sells exactly
// `amount` of A, its first step taking `amount` and its second the first's whole output (an amount
// of 0); "given out" buys exactly `amount` of C, its steps running backwards from C. `limit` bounds
// the other side, as the guide's limits do: the least C, or the most A. It returns what the Pot
// paid in A and what `recipient` received in C.
//
// Ported from balancer/docs, docs/reference/swaps/batch-swaps.md (30 lines, 30 of code):
// https://github.com/balancer/docs/blob/bc51cd265e21152ff22e59c7ffac50d3529db25c/docs/reference/swaps/batch-swaps.md
//
// What changes in Sauce: the guide gives `batchSwap`'s interface and its two multi-hop examples as
// tables, not a contract; the program is those examples, through `BalancerV2.Vault`. The Pot is
// the sender and pays from its own balance; `recipient` receives. The guide's warning holds: limits
// computed on chain by `queryBatchSwap` in the same transaction can be sandwiched, so `limit` is a
// `main` input, worked out before the transaction. Its count is the guide's code: the interface
// and its structs.
//
//   sauce run balancer-v2-batch-swap.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <givenOut> <poolAB> <poolBC> <a> <b> <c> <amount> <limit> <recipient>
//
//   givenOut: bool       false: sell exactly `amount` of A; true: buy exactly `amount` of C
//   poolAB: Uint256      the id of the pool that trades A and B, as the Vault names it
//   poolBC: Uint256      the id of the pool that trades B and C
//   a: Address           the token paid
//   b: Address           the token between
//   c: Address           the token received
//   amount: Uint256      the A to sell, or the C to buy, in its smallest units:
//                        1000000000 is 1,000 USDC (6 decimals)
//   limit: Uint256       the least C to accept, or with `givenOut` the most A to pay
//   recipient: Address   who receives the C
//
// On Ethereum, 1,000 USDC sold for WBTC through WETH, in the 50/50 USDC/WETH and WBTC/WETH pools:
//
//   sauce run balancer-v2-batch-swap.sauce.ts --chain ethereum --keystore <keystore> \
//     --args false 0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019 \
//     0xa6f548df93de924d73be7d25dc02554c6bd66db500020000000000000000000e \
//     0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
//     <wbtc> 1000000000 <limit> <recipient>

const GIVEN_IN = 0;
const GIVEN_OUT = 1;

interface Swapped {
  paid: Uint256;
  received: Uint256;
}

function main(
  givenOut: bool,
  poolAB: Uint256,
  poolBC: Uint256,
  a: Address,
  b: Address,
  c: Address,
  amount: Uint256,
  limit: Uint256,
  recipient: Address,
): Swapped {
  require(BalancerV2.Vault);
  const maxIn = givenOut ? limit : amount;
  approve(a, BalancerV2.Vault, maxIn);
  // Example 1, given in: A → B, then all of that B → C. Example 2, given out: C ← B first, then
  // the B that costs ← A. The second step's amount is 0: the first step's result.
  const swaps = [
    {
      poolId: givenOut ? poolBC : poolAB,
      assetInIndex: givenOut ? 1 : 0,
      assetOutIndex: givenOut ? 2 : 1,
      amount,
      userData: hex``,
    },
    {
      poolId: givenOut ? poolAB : poolBC,
      assetInIndex: givenOut ? 0 : 1,
      assetOutIndex: givenOut ? 1 : 2,
      amount: 0,
      userData: hex``,
    },
  ];
  const funds = {
    sender: ctx.self(),
    fromInternalBalance: false,
    recipient,
    toInternalBalance: false,
  };
  // A limit is what the Vault may take of each asset: positive in, negative out. Signed, as the
  // Vault's `int256[]` is.
  const limits: Int256[] = [Int256(maxIn), 0, givenOut ? -Int256(amount) : -Int256(limit)];
  const deltas = BalancerV2.Vault.batchSwap(
    givenOut ? GIVEN_OUT : GIVEN_IN,
    swaps,
    [a, b, c],
    funds,
    limits,
    ctx.timestamp(),
  );
  // What the Vault did not take of the allowance does not stand.
  if (deltas[0] < maxIn) {
    approve(a, BalancerV2.Vault, 0);
  }
  // The Vault's deltas are signed: what it took of `a`, and minus what it paid of `c`.
  return { paid: Uint256(deltas[0]), received: Uint256(-deltas[2]) };
}
