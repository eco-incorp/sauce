// Pay `amount` of USDC to `recipient` only if a Chainlink CRE workflow reports a price at most
// `limit`. The program asks `owner`'s workflow for `pair`'s price; the workflow answers within the
// hour, in a transaction of its own, and the body runs then, on this Pot. A report over the limit,
// or one the workflow marks failed, runs `.catch` instead, which logs why; past the hour, anyone may
// expire the request, and `.catch` runs with the timeout.
//
//   sauce run price-gate.sauce.ts --chain <chain> --wallet <name> \
//     --args <owner> <pair> <limit> <recipient> <amount>
//
//   owner: Address      the workflow owner whose report alone answers
//   pair: string        the pair whose price the workflow reports, such as ETH/USD; the workflow
//                       reads it as one ABI-encoded string
//   limit: Uint256      the highest price to pay at, in the workflow's units: 400000000000 is
//                       4,000 for a price with 8 decimals
//   recipient: Address  who is paid
//   amount: Uint256     how much USDC, in its smallest units: 1000000 is 1 USDC (6 decimals)
//
// On Base, 1 USDC to `<recipient>` if the workflow reports ETH/USD at most 4,000 (8 decimals):
//
//   sauce run price-gate.sauce.ts --chain base --wallet <name> \
//     --args <owner> ETH/USD 400000000000 <recipient> 1000000
//
// The Pot holds the USDC, and the native coin for the cook the report pays from it, and has
// `@sauce/oracle` installed: `sauce run @sauce/oracle --chain <chain> --wallet <name>`.
import { Oracle } from "@sauce/oracle";

function main(owner: Address, pair: string, limit: Uint256, recipient: Address, amount: Uint256) {
  Oracle.cre({ owner, args: abi.encode(pair) })
    .within(3600)
    .then((report) => {
      const [price] = abi.decode(report, ["Uint256"]);
      require(price <= limit, "above the limit");
      USDC.transfer(recipient, amount);
    })
    .catch((err) => {
      log(err);
    });
}
