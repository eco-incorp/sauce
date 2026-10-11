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
// which a workflow's EVM Log trigger listens for, and parks the body as a promise (`@sauce/async`).
// `id` is the request's own: the chain, the Pot and the Pot's count of the requests it has made, so
// no two requests share one and a report for one chain names nothing on another. `owner` is the
// workflow owner the request is for. `args` is what the workflow reads, as the program encodes it.
// A `deadline` (or `.within(seconds)`) lets anyone reject a request no report answered in time,
// through the Pot's `expire(bytes32 key)`, which runs `.catch` with `Timeout(bytes32 key)`.
//
// THE REPORT. The workflow answers with a report whose payload is
//
//   abi.encode(bytes32 id, bool ok, bytes data)
//
// `ok` true fulfils the request, and the body is handed `data`; false rejects it, and `.catch` is
// handed `data`, the workflow's error. Chainlink's KeystoneForwarder checks the DON's signatures,
// asks the Pot over ERC-165 whether it is an `IReceiver` (0x805f2132), and calls its
// `onReport(bytes metadata, bytes report)`, which the Pot answers with the handler this package's
// `onReport` is the body of. The first request on a Pot installs both, the handler and the
// interface, unless the Pot already has them. A report for a request already settled, or for
// none, changes nothing and returns.
//
// WHO MAY ANSWER. Any workflow's DON can reach the forwarder, so the forwarder as the caller proves
// only that a workflow signed the report. The workflow owner in the report's metadata is the
// authentication: a request's promise key is `promiseKey(ORACLE_CRE, keccak256(abi.encode(owner,
// id)))`, and the handler derives it from the owner the metadata names, so a report from any other
// owner finds no request.
//
// The forwarder's call is written out, selector and arguments, as Chainlink's `IReceiver` declares
// it: `onReport(bytes,bytes)` (0x805f2132), whose `metadata` is the 64 bytes `workflowId` (32),
// `workflowName` (10), `workflowOwner` (20), `reportId` (2). The SDK's tests run it through the
// forwarder deployed on Ethereum and Base, its runtime as captured.
import { Handler, Request, fulfil, promiseKey, reject, requireCaller } from "@sauce/async";

// `onReport(bytes,bytes)`, the call the forwarder makes, and `IReceiver`'s ERC-165 id, the same four
// bytes: the interface declares that one function.
const ON_REPORT = 0x805f2132;
const IRECEIVER = 0x805f2132;

// The event a request logs: keccak256("OracleRequest(bytes32,address,bytes)").
const ORACLE_REQUEST = 0xc110c892d7bf322caf684db2c33c898be8770bb1a502d0845097c8672c9874ed;

// The tag of this package's promise keys, keccak256("sauce.oracle.cre"), so its ids never meet
// another protocol's.
const ORACLE_CRE = 0xe0c066f41c1dc7e55f8fdb9c65959880975a5253ce7ee0f0fe9c8196947500dd;

// The ERC-7201 namespace this package keeps in the Pot's storage:
// keccak256(abi.encode(uint256(keccak256("sauce.storage.Oracle")) - 1)) & ~bytes32(uint256(0xff)).
// Its first slot counts the requests the Pot has made.
const SAUCE_ORACLE_NAMESPACE = 0xfb914c48cb718df1ddac58f9ecf041e1351f5cba973af6506236543b47c9ff00;

// What `Oracle.cre(…)` takes, each field described on `cre` below. `owner` is optional here only so
// that leaving it out is refused with why, rather than as a missing member.
export interface CreOptions {
  owner?: Address;
  args?: bytes;
  deadline?: Uint256;
}

// The requests a program makes: `Oracle.cre(config)`, one per oracle network this package speaks.
export class Oracle {
  // A request to a Chainlink CRE workflow, which `config` names:
  //
  //   owner     the workflow owner whose report alone settles it; required
  //   args      what the workflow reads, as bytes (`abi.encode(…)` of it); none when left out
  //   deadline  a unix time after which anyone may expire the request; or `.within(seconds)`
  static cre(config: CreOptions) {
    if (config === undefined) {
      throw new Error("`Oracle.cre(...)` takes one object: `Oracle.cre({ owner, args })`");
    }
    const owner = config.owner;
    if (owner === undefined) {
      throw new Error(
        "`Oracle.cre` needs an `owner`: the workflow owner whose report settles the request. Any workflow can reach Chainlink's forwarder, so the owner is what proves the answer is the one asked for.",
      );
    }
    if (!Chainlink.KeystoneForwarder) {
      throw new Error(
        "`Oracle.cre` needs Chainlink's KeystoneForwarder, which delivers a CRE workflow's report, and this chain has none",
      );
    }
    const args = config.args === undefined ? hex`` : config.args;
    return new Request({
      // What the Pot needs to take the report, installed with the first request: the program it
      // runs for `onReport`, the same as `report.handler.js`, and `IReceiver` declared for the
      // forwarder's ERC-165 check.
      handlers: [
        new Handler(ON_REPORT, (caller: Address, value: Uint256, data: bytes) => {
          onReport(Chainlink.KeystoneForwarder, caller, data);
        }),
      ],
      interfaces: [IRECEIVER],
      deadline: config.deadline,
      send: (continuation) => {
        const count = evm.sload(SAUCE_ORACLE_NAMESPACE) + 1;
        evm.sstore(SAUCE_ORACLE_NAMESPACE, count);
        const id = crypto.keccak256(abi.encode(ctx.chainId(), ctx.self(), count));
        log(abi.encode(args), ORACLE_REQUEST, id, owner);
        return promiseKey(ORACLE_CRE, crypto.keccak256(abi.encode(owner, id)));
      },
    });
  }
}

// The body of the handler for `onReport(bytes metadata, bytes report)`, the call a CRE report lands
// on: from `forwarder` alone, it settles the request the report answers, under the key the report's
// id and the metadata's workflow owner derive — fulfilled with the report's data, or rejected with
// it when the report is not `ok`.
export function onReport(forwarder: Address, caller: Address, data: bytes): void {
  requireCaller(forwarder, caller);
  const [metadata, report] = abi.decode(data.slice(4, data.length), ["bytes", "bytes"]);
  require(metadata.length >= 62, "oracle: the report's metadata names no workflow owner");
  const owner = metadata.slice(42, 62).toBe();
  const [id, ok, result] = abi.decode(report, ["Uint256", "bool", "bytes"]);
  const key = promiseKey(ORACLE_CRE, crypto.keccak256(abi.encode(owner, id)));
  if (ok) {
    fulfil(key, result);
  } else {
    reject(key, result);
  }
}
