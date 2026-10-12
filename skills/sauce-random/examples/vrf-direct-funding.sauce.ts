// Chainlink's DirectFundingConsumer, in Sauce: a request for two random words, paid by direct
// funding in the native coin, its status kept on the Pot and its words written there when VRF
// answers.
//
// Ported from: smartcontractkit/documentation, public/samples/VRF/v2-5/DirectFundingConsumer.sol
//
//   requestRandomWords(true)   this program: the Pot pays the wrapper's price in the native coin
//   s_requests, lastRequestId  the Pot's storage under "DirectFundingConsumer.requests", by the Pot's
//                              own count of its requests, which the program returns
//   fulfillRandomWords         the `.then` body
//   RequestSent, RequestFulfilled  the same events, from the Pot
//   getRequestStatus           a read of the Pot's storage: paid, fulfilled, then the words
//   callbackGasLimit           sized from the body; `gas` in `Random.vrf` sets it
//   LINK payment, withdrawLink, withdrawNative, receive: left out. VRF is paid in the native coin,
//   and the Pot's owner moves its funds with any program.
//
//   sauce run vrf-direct-funding.sauce.ts --chain <chain> --wallet <name> --password-env <NAME>
//
// On Base:
//
//   sauce run vrf-direct-funding.sauce.ts --chain base --wallet <name> --password-env <NAME>
import { Random } from "@sauce/random";

function main(): Uint256 {
  const requests = crypto.keccak256("DirectFundingConsumer.requests");
  const requestId = evm.sload(requests) + 1;
  evm.sstore(requests, requestId);
  // s_requests[requestId]: paid, fulfilled, then the words.
  const status = crypto.keccak256(abi.encode(requestId, requests));
  const before = ctx.selfBalance();
  Random.vrf({ words: 2, confirmations: 3 }).then((randomWords) => {
    require(evm.sload(status) > 0, "request not found");
    evm.sstore(status + 1, 1);
    evm.sstore(status + 2, randomWords[0]);
    evm.sstore(status + 3, randomWords[1]);
    const event = crypto.keccak256("RequestFulfilled(uint256,uint256[],uint256)");
    log(abi.encode(requestId, randomWords, evm.sload(status)), event);
  });
  evm.sstore(status, before - ctx.selfBalance());
  log(abi.encode(requestId, 2), crypto.keccak256("RequestSent(uint256,uint32)"));
  return requestId;
}
