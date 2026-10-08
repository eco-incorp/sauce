// @sauce/oracle — EVM arm.
//
// An off-chain result, delivered to a `.then`. A program asks a Chainlink CRE workflow — code its
// owner deployed to Chainlink's network, which fetches an API, computes, and reaches consensus —
// and the body runs on the same Private Pot when the workflow's report comes back:
//
//   import { Oracle } from "@sauce/oracle";
//
//   function main(owner: Address, pair: bytes, limit: Uint256, recipient: Address, amount: Uint256): void {
//     Oracle.cre({ owner, args: pair })
//       .then((report) => {
//         const [price] = abi.decode(report, ["Uint256"]);
//         require(price <= limit, "above the limit");
//         USDC.transfer(recipient, amount);
//       })
//       .catch((err) => {
//         log(err);
//       });
//   }
//
// THE REQUEST. `Oracle.cre({ owner, args })` logs, from the Pot,
//
//   OracleRequest(bytes32 indexed id, address indexed owner, bytes args)
//
// which a workflow's EVM Log trigger listens for, and parks the body under the request's key. `id`
// is the request's own: the chain, the Pot and the Pot's count of the requests it has made, so no
// two requests share one and a report for one chain names nothing on another. `owner` is the
// workflow owner the request is for. `args` is what the workflow reads, as the program encodes it.
//
// THE REPORT. The workflow answers with a report whose payload is
//
//   abi.encode(bytes32 id, bool ok, bytes data)
//
// `ok` true fulfils the request, and the body is handed `data`; false rejects it, and `.catch` is
// handed `data`, the workflow's error. Chainlink's KeystoneForwarder checks the DON's signatures and
// calls the Pot's `onReport(bytes metadata, bytes report)`, which the Pot answers with the handler
// this package's `onReport` is the body of.
//
// WHO MAY ANSWER. Any workflow's DON can reach the forwarder, so the forwarder as the caller proves
// only that a workflow signed the report. The workflow owner in the report's metadata is the
// authentication: a request's key is `keccak256(abi.encode(id, owner))`, and the handler derives the
// key from the owner the metadata names, so a report from any other owner finds no request.
//
// The forwarder's call is written out, selector and arguments, as Chainlink's `IReceiver` declares
// it: `onReport(bytes,bytes)` (0x805f2132), whose `metadata` is the 64 bytes `workflowId` (32),
// `workflowName` (10), `workflowOwner` (20), `reportId` (2). The SDK's tests run it through the
// forwarder deployed on Ethereum and Base, its runtime as captured.
import { Request, requireCaller, run, take } from "@sauce/async";

// The event a request logs: keccak256("OracleRequest(bytes32,address,bytes)").
const ORACLE_REQUEST = 0xc110c892d7bf322caf684db2c33c898be8770bb1a502d0845097c8672c9874ed;

// The ERC-7201 namespace this package keeps in the Pot's storage:
// keccak256(abi.encode(uint256(keccak256("sauce.storage.Oracle")) - 1)) & ~bytes32(uint256(0xff)).
// Its first slot counts the requests the Pot has made.
const SAUCE_ORACLE_NAMESPACE = 0xfb914c48cb718df1ddac58f9ecf041e1351f5cba973af6506236543b47c9ff00;

// The requests a program makes: `Oracle.cre(config)`, one per oracle network this package speaks.
class Requests {
  // A request to a Chainlink CRE workflow, which `config` names:
  //
  //   owner  the workflow owner whose report alone settles it; required
  //   args   what the workflow reads, as bytes (`abi.encode(…)` of it); none when left out
  cre(config) {
    if (config === undefined) {
      throw new Error("`Oracle.cre(...)` takes one object: `Oracle.cre({ owner, args })`");
    }
    const fields = { owner: true, args: true };
    for (const key of Object.keys(config)) {
      if (fields[key] === undefined) {
        throw new Error("`Oracle.cre` takes no `" + key + "`: its fields are owner and args");
      }
    }
    const owner = config.owner;
    if (owner === undefined) {
      throw new Error(
        "`Oracle.cre` needs an `owner`: the workflow owner whose report settles the request. Any workflow can reach Chainlink's forwarder, so the owner is what proves the answer is the one asked for.",
      );
    }
    const args = config.args === undefined ? hex`` : config.args;
    return new Request({
      send: (continuation) => {
        const count = evm.sload(SAUCE_ORACLE_NAMESPACE) + 1;
        evm.sstore(SAUCE_ORACLE_NAMESPACE, count);
        const id = crypto.keccak256(abi.encode(ctx.chainId(), ctx.self(), count));
        log(abi.encode(args), ORACLE_REQUEST, id, owner);
        return crypto.keccak256(abi.encode(id, owner));
      },
      deliver: (input, body, fail) => {
        const [ok, data] = abi.decode(input, ["bool", "bytes"]);
        if (ok) {
          body(data);
        } else {
          fail(data);
        }
      },
    });
  }
}

export const Oracle = new Requests();

// The body of the handler for `onReport(bytes metadata, bytes report)`, the call a CRE report lands
// on: from `forwarder` alone, it finds the request the report answers under the key the report's
// id and the metadata's workflow owner derive, and runs its continuation with what the report says.
export function onReport(forwarder: Address, caller: Address, data: bytes): void {
  requireCaller(forwarder, caller);
  const [metadata, report] = abi.decode(data.slice(4, data.length), ["bytes", "bytes"]);
  require(metadata.length >= 62, "oracle: the report's metadata names no workflow owner");
  const owner = metadata.slice(42, 62).toBe();
  const [id, ok, result] = abi.decode(report, ["Uint256", "bool", "bytes"]);
  run(take(crypto.keccak256(abi.encode(id, owner))), abi.encode(ok, result));
}
