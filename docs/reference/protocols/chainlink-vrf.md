<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink VRF (`chainlink-vrf`)

Chainlink's verifiable random function, v2.5, by direct funding: a contract pays each request in the
chain's native coin through the VRFV2PlusWrapper, with no subscription to create or fund, and the
wrapper calls it back with the random words.

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `ChainlinkVrf` on ethereum, base |
| Chains | ethereum, base |

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

## Its names in a program

On Ethereum, `ChainlinkVrf` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's coordinator, `0xD7f86b4b8Cae7D942340FF628F82735b7a20893a`.
  require(ChainlinkVrf.Coordinator != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | coordinator | `0xD7f86b4b8Cae7D942340FF628F82735b7a20893a` | `ChainlinkVrf.Coordinator` |
| [Ethereum](../chains/ethereum.md) | wrapper | `0x02aae1A04f9828517b3007f83f6181900CaD910c` | `ChainlinkVrf.Wrapper` |
| [Base](../chains/base.md) | coordinator | `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634` | `ChainlinkVrf.Coordinator` |
| [Base](../chains/base.md) | wrapper | `0xb0407dbe851f8318bd31404A49e658143C982F23` | `ChainlinkVrf.Wrapper` |

## ABI

### `VRFCoordinatorV2_5ABI`

`import VRFCoordinatorV2_5ABI from "./protocols/chainlink-vrf/VRFCoordinatorV2_5ABI.json";` Speaks for: coordinator.

- `s_config() view returns (uint16 minimumRequestConfirmations, uint32 maxGasLimit, bool reentrancyLock, uint32 stalenessSeconds, uint32 gasAfterPaymentCalculation, uint32 fulfillmentFlatFeeNativePPM, uint32 fulfillmentFlatFeeLinkDiscountPPM, uint8 nativePremiumPercentage, uint8 linkPremiumPercentage)`
- `MAX_NUM_WORDS() view returns (uint32)`
- `MAX_REQUEST_CONFIRMATIONS() view returns (uint16)`

### `VRFV2PlusWrapperABI`

`import VRFV2PlusWrapperABI from "./protocols/chainlink-vrf/VRFV2PlusWrapperABI.json";` Speaks for: wrapper.

- `requestRandomWordsInNative(uint32 _callbackGasLimit, uint16 _requestConfirmations, uint32 _numWords, bytes extraArgs) payable returns (uint256 requestId)`
- `calculateRequestPriceNative(uint32 _callbackGasLimit, uint32 _numWords) view returns (uint256)`
- `estimateRequestPriceNative(uint32 _callbackGasLimit, uint32 _numWords, uint256 _requestGasPriceWei) view returns (uint256)`
- `getConfig() view returns (int256 fallbackWeiPerUnitLink, uint32 stalenessSeconds, uint32 fulfillmentFlatFeeNativePPM, uint32 fulfillmentFlatFeeLinkDiscountPPM, uint32 wrapperGasOverhead, uint32 coordinatorGasOverheadNative, uint32 coordinatorGasOverheadLink, uint16 coordinatorGasOverheadPerWord, uint8 wrapperNativePremiumPercentage, uint8 wrapperLinkPremiumPercentage, bytes32 keyHash, uint8 maxNumWords)`
- `s_vrfCoordinator() view returns (address)`
