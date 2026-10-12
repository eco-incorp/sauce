// Ported from: smartcontractkit/cre-templates,
// starter-templates/circuit-breaker/circuit-breaker-ts/contracts/evm/src/ProtocolWithBreaker.sol
// (at d0223f31), a protocol a Chainlink CRE workflow pauses when a price deviates: a report of
// abi.encode(uint8 action, string reason) pauses it and counts a trip (action 1), emitting
// CircuitBreakerTripped(reason, tripCount, timestamp), or resumes it (action 2), emitting
// CircuitBreakerReset(timestamp).
//
// The contract waits for the workflow to push its report; a Pot asks for one. The program asks
// `owner`'s workflow, and the report's data runs the body, which does what the contract's
// _processReport does: the paused flag and the trip count in the Pot's storage, and the same two
// events, as the contract emits them. What the contract's base, ReceiverTemplate, checks (the
// forwarder, the workflow owner) and answers (ERC-165) is `@sauce/oracle`'s. The contract's
// updatePrice, which the template marks a stand-in for a price feed, stays out.
//
//   sauce run circuit-breaker.sauce.ts --chain <chain> --wallet <name> --args <owner>
//
//   owner: Address  the circuit-breaker workflow's owner, whose report alone answers
//
// On Base:
//
//   sauce run circuit-breaker.sauce.ts --chain base --wallet <name> --args <owner>
//
// The contract is 65 lines of Solidity, 44 of them code, on a 242-line ReceiverTemplate; this
// program is 20.
import { Oracle } from "@sauce/oracle";

const ACTION_PAUSE = 1;
const ACTION_UNPAUSE = 2;

function main(owner: Address) {
  Oracle.cre({ owner }).then((report) => {
    // Where the Pot keeps what the contract keeps, at keccak256 of each name.
    const paused = crypto.keccak256("ProtocolWithBreaker.paused");
    const trips = crypto.keccak256("ProtocolWithBreaker.tripCount");
    const [action, reason] = abi.decode(report, ["Uint256", "string"]);
    if (action == ACTION_PAUSE) {
      const tripCount = evm.sload(trips) + 1;
      evm.sstore(paused, 1);
      evm.sstore(trips, tripCount);
      const tripped = crypto.keccak256("CircuitBreakerTripped(string,uint256,uint256)");
      log(abi.encode(reason, ctx.timestamp()), tripped, tripCount);
    } else if (action == ACTION_UNPAUSE) {
      evm.sstore(paused, 0);
      log(abi.encode(ctx.timestamp()), crypto.keccak256("CircuitBreakerReset(uint256)"));
    }
  });
}
