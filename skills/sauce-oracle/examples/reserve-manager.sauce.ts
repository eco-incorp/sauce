// Ported from: smartcontractkit/cre-templates,
// starter-templates/custom-data-feed/cre-custom-data-feed-go/contracts/evm/src/ReserveManager.sol
// (at d0223f31), the proof-of-reserve consumer a Chainlink CRE workflow reports to: it records the
// total minted and the total reserve the report carries, counts the update, and emits
// RequestReserveUpdate with both.
//
// The contract waits for the workflow to push its report; a Pot asks for one. The program asks
// `owner`'s workflow, and the report's data, abi.encode(uint256 totalMinted, uint256 totalReserve),
// runs the body, which does what the contract's onReport does: records both and counts the update
// in the Pot's storage, and logs RequestReserveUpdate((uint256,uint256)) with them, as the contract
// emits it. The contract takes onReport from anyone; the Pot runs the body only for a report the
// forwarder delivers from `owner`'s workflow, and answers ERC-165: those are `@sauce/oracle`'s.
//
//   sauce run reserve-manager.sauce.ts --chain <chain> --wallet <name> --args <owner>
//
//   owner: Address  the proof-of-reserve workflow's owner, whose report alone answers
//
// On Base:
//
//   sauce run reserve-manager.sauce.ts --chain base --wallet <name> --args <owner>
//
// The contract is 33 lines of Solidity, 25 of them code, beside the IReceiver interface; this
// program is 12.
import { Oracle } from "@sauce/oracle";

function main(owner: Address) {
  Oracle.cre({ owner }).then((report) => {
    const [totalMinted, totalReserve] = abi.decode(report, ["Uint256", "Uint256"]);
    // Where the Pot keeps what the contract keeps, at keccak256 of each name.
    evm.sstore(crypto.keccak256("ReserveManager.lastTotalMinted"), totalMinted);
    evm.sstore(crypto.keccak256("ReserveManager.lastTotalReserve"), totalReserve);
    const counter = crypto.keccak256("ReserveManager.requestIdCounter");
    evm.sstore(counter, evm.sload(counter) + 1);
    const update = crypto.keccak256("RequestReserveUpdate((uint256,uint256))");
    log(abi.encode(totalMinted, totalReserve), update);
  });
}
