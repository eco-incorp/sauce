<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink CCIP (`chainlink-ccip`)

Cross-Chain Interoperability Protocol by Chainlink. Enterprise-grade cross-chain messaging with DON-based security and token transfers.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `ChainlinkCcip` on ethereum, optimism, polygon, arc, base, arbitrum |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum |
| Document | [chainlink-ccip.md](../chainlink-ccip.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `ChainlinkCcip` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's router, `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D`.
  require(ChainlinkCcip.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D` | `ChainlinkCcip.Router` |
| [Optimism](../../../sauce-chains/references/optimism.md) | router | `0x3206695CaE29952f4b0c22a169725a865bc8Ce0f` | `ChainlinkCcip.Router` |
| [Polygon](../../../sauce-chains/references/polygon.md) | router | `0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe` | `ChainlinkCcip.Router` |
| [Arc](../../../sauce-chains/references/arc.md) | router | `0xB79791184973589c38e114D43Eb8E4588C283A18` | `ChainlinkCcip.Router` |
| [Base](../../../sauce-chains/references/base.md) | router | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` | `ChainlinkCcip.Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x141fa059441E0ca23ce184B6A78bafD2A517DdE8` | `ChainlinkCcip.Router` |

## ABI

### `CCIPRouterABI`

`import CCIPRouterABI from "./protocols/chainlink-ccip/CCIPRouterABI.json";` Speaks for: router. The import is the contract's full ABI across every deployment; call it through the `ChainlinkCcip` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `applyRampUpdates((uint64 destChainSelector, address onRamp)[] onRampUpdates, (uint64 sourceChainSelector, address offRamp)[] offRampRemoves, (uint64 sourceChainSelector, address offRamp)[] offRampAdds)`
- `ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32 messageId)`
- `getArmProxy() view returns (address)`
- `getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256 fee)`
- `getOffRamps() view returns ((uint64 sourceChainSelector, address offRamp)[])`
- `getOnRamp(uint64 destChainSelector) view returns (address)`
- `getSupportedTokens(uint64 chainSelector) view returns (address[])`
- `getWrappedNative() view returns (address)`
- `isChainSupported(uint64 chainSelector) view returns (bool)`
- `isOffRamp(uint64 sourceChainSelector, address offRamp) view returns (bool)`
- `MAX_RET_BYTES() view returns (uint16)`
- `owner() view returns (address)`
- `recoverTokens(address tokenAddress, address to, uint256 amount)`
- `routeMessage((bytes32 messageId, uint64 sourceChainSelector, bytes sender, bytes data, (address token, uint256 amount)[] destTokenAmounts) message, uint16 gasForCallExactCheck, uint256 gasLimit, address receiver) returns (bool success, bytes retData, uint256 gasUsed)`
- `setWrappedNative(address wrappedNative)`
- `transferOwnership(address to)`
- `typeAndVersion() view returns (string)`
