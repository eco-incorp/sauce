// Chainlink's SubscriptionConsumer, in Sauce: a request for two random words, its status kept on the
// Pot and its words written there when VRF answers.
//
// Ported from: smartcontractkit/documentation, public/samples/VRF/v2-5/SubscriptionConsumer.sol
//
//   requestRandomWords      this program
//   s_requests, lastRequestId  the Pot's storage under "SubscriptionConsumer.requests", by the Pot's
//                           own count of its requests, which the program returns
//   fulfillRandomWords      the `.then` body
//   RequestSent, RequestFulfilled  the same events, from the Pot
//   getRequestStatus        a read of the Pot's storage: exists, fulfilled, then the words
//   s_subscriptionId, keyHash: left out. The Pot pays each request by direct funding, in the native
//   coin, rather than from a subscription it would have to create and fund.
//
//   sauce run vrf-subscription.sauce.ts --chain <chain> --wallet <name> --password-env <NAME>
//
// On Ethereum:
//
//   sauce run vrf-subscription.sauce.ts --chain ethereum --wallet <name> --password-env <NAME>
import { Random } from "@sauce/random";

function main(): Uint256 {
  const requests = crypto.keccak256("SubscriptionConsumer.requests");
  const requestId = evm.sload(requests) + 1;
  evm.sstore(requests, requestId);
  // s_requests[requestId]: exists, fulfilled, then the words.
  const status = crypto.keccak256(abi.encode(requestId, requests));
  evm.sstore(status, 1);
  Random.vrf({ words: 2, confirmations: 3 }).then((randomWords) => {
    require(evm.sload(status) == 1, "request not found");
    evm.sstore(status + 1, 1);
    evm.sstore(status + 2, randomWords[0]);
    evm.sstore(status + 3, randomWords[1]);
    log(
      abi.encode(requestId, randomWords),
      crypto.keccak256("RequestFulfilled(uint256,uint256[])"),
    );
  });
  log(abi.encode(requestId, 2), crypto.keccak256("RequestSent(uint256,uint32)"));
  return requestId;
}
