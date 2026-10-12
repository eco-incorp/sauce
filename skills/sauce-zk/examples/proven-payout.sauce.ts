// Pays `amount` of the chain's native coin to `recipient` once Space and Time proves a SQL query's
// first value is at least `minimum`. The query is `plan`, the proof plan Space and Time's RPC
// method `commitments_v1_evmProofPlan` gives for the SQL, and it pays `payment` of SXT (at least the
// QueryRouter's `baseCost()`), which the Pot holds. If the query is not answered within the hour,
// anyone may expire it, and its payment comes back to the Pot. The Pot must be a Private Pot with
// handlers it needs, which the first request installs.
//
//   sauce run proven-payout.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <plan> <payment> <minimum> <recipient> <amount>
//
//   plan: bytes  the query's proof plan
//   payment: Uint256  what the query pays, in SXT's base units (18 decimals)
//   minimum: Uint256  the least the query's first value may be
//   recipient: Address  who is paid
//   amount: Uint256  how much of the native coin, in wei
//
// On Base, 0.01 ETH once the query's first value is at least 1000, paying 200 SXT:
//
//   sauce run proven-payout.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <plan> 200000000000000000000 1000 <recipient> 10000000000000000
import { Zk } from "@sauce/zk";

function main(
  plan: bytes,
  payment: Uint256,
  minimum: Uint256,
  recipient: Address,
  amount: Uint256,
): void {
  Zk.sql({ query: plan, payment })
    .then((result) => {
      require(Zk.cell(result, 0, 0) >= minimum, "below the minimum");
      evm.call(recipient, amount, hex``);
    })
    .catch((e) => {
      Zk.cancel(e);
    });
}
