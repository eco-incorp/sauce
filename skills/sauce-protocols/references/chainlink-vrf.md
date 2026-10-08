# Chainlink VRF

Chainlink's verifiable random function, v2.5, by direct funding: a contract pays each request in the
chain's native coin through the VRFV2PlusWrapper, with no subscription to create or fund, and the
wrapper calls it back with the random words.

## Category

oracle | Chains and addresses: [registry/chainlink-vrf.md](registry/chainlink-vrf.md)

## Key Operations

- **requestPriceNative**: what one request costs in the native coin, at the transaction's gas price
- **minimumRequestConfirmations**: the fewest blocks the coordinator lets a request wait

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// The price of one request, in wei, at this transaction's gas price
import { VRFV2PlusWrapperABI as IVRFV2PlusWrapper } from "./abis";
function main(wrapperAddress: Address, callbackGasLimit: Uint256, numWords: Uint256): Uint256 {
  return IVRFV2PlusWrapper.at(wrapperAddress).calculateRequestPriceNative(
    callbackGasLimit,
    numWords,
  );
}
```

```typescript
// The coordinator's minimum request confirmations
import { VRFCoordinatorV2_5ABI as IVRFCoordinatorV2_5 } from "./abis";
function main(coordinatorAddress: Address): Uint256 {
  return IVRFCoordinatorV2_5.at(coordinatorAddress).s_config().minimumRequestConfirmations;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/chainlink-vrf.md](registry/chainlink-vrf.md).

## Notes

- A request is `requestRandomWordsInNative`, sent with value: its callback gas limit, request
  confirmations, number of words and `extraArgs`. It needs at least `calculateRequestPriceNative`
  for the same gas limit and words, and keeps any excess, so pay the price read in the same
  transaction: it is computed from the transaction's gas price, and a read outside it (an
  `eth_call` with no gas price) can return far less.
- `extraArgs` must ask for native payment: the four bytes `0x92fd1338` (`VRF ExtraArgsV1`) and a
  `true` word, 36 bytes. Empty `extraArgs` reverts with `LINKPaymentInRequestRandomWordsInNative`.
- The wrapper allows at most 10 words a request, and the coordinator caps the callback's gas plus
  the wrapper's overhead at its `maxGasLimit`: a callback gas limit of about 2,447,000 at most.
  Ethereum's coordinator wants at least 3 confirmations; Base's allows 0.
- The wrapper records the caller as the request's consumer and calls it back with
  `rawFulfillRandomWords(uint256 requestId, uint256[] randomWords)`, from the wrapper's own address,
  with exactly `callbackGasLimit` gas. Authenticate that caller: the wrapper, not the coordinator.
- A callback that reverts or runs out of gas is caught: the wrapper emits
  `WrapperFulfillmentFailed(requestId, consumer)` and the request is spent, paid for and never
  retried. Size the callback gas limit for everything the callback runs.
- The request id the call returns is the one the callback carries; the wrapper's `lastRequestId`
  is not set for native requests.
- A Sauce program receives the words with `@sauce/random`'s `Random.vrf`, which pays the price,
  keeps the continuation under the request id and authenticates the wrapper.
