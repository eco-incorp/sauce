<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink VRF (`chainlink-vrf`)

Chainlink's verifiable random function, v2.5. Direct funding: a contract pays each request in the native coin through the VRFV2PlusWrapper, with no subscription, and the wrapper calls it back with the random words.

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `ChainlinkVrf` on ethereum, base |
| Chains | ethereum, base |
| Document | [chainlink-vrf.md](../chainlink-vrf.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `ChainlinkVrf` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's coordinator, `0xD7f86b4b8Cae7D942340FF628F82735b7a20893a`.
  require(ChainlinkVrf.Coordinator != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | coordinator | `0xD7f86b4b8Cae7D942340FF628F82735b7a20893a` | `ChainlinkVrf.Coordinator` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | wrapper | `0x02aae1A04f9828517b3007f83f6181900CaD910c` | `ChainlinkVrf.Wrapper` |
| [Base](../../../sauce-chains/references/base.md) | coordinator | `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634` | `ChainlinkVrf.Coordinator` |
| [Base](../../../sauce-chains/references/base.md) | wrapper | `0xb0407dbe851f8318bd31404A49e658143C982F23` | `ChainlinkVrf.Wrapper` |

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
