<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink CCIP (`chainlink-ccip`)

Cross-Chain Interoperability Protocol by Chainlink. Enterprise-grade cross-chain messaging with DON-based security and token transfers.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum |
| Document | [chainlink-ccip.md](../chainlink-ccip.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's router):

```sauce chain=ethereum
import CCIPRouterABI from "./protocols/chainlink-ccip/CCIPRouterABI.json";

const ROUTER = 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7Dn;

function main() {
  const bound = CCIPRouterABI.at(ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D` | `CCIPRouterABI.at(0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7Dn)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | router | `0x3206695CaE29952f4b0c22a169725a865bc8Ce0f` | `CCIPRouterABI.at(0x3206695CaE29952f4b0c22a169725a865bc8Ce0fn)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | router | `0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe` | `CCIPRouterABI.at(0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfen)` |
| [Arc](../../../sauce-chains/references/arc.md) | router | `0xB79791184973589c38e114D43Eb8E4588C283A18` | `CCIPRouterABI.at(0xB79791184973589c38e114D43Eb8E4588C283A18n)` |
| [Base](../../../sauce-chains/references/base.md) | router | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` | `CCIPRouterABI.at(0x881e3A65B4d4a04dD529061dd0071cf975F58bCDn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x141fa059441E0ca23ce184B6A78bafD2A517DdE8` | `CCIPRouterABI.at(0x141fa059441E0ca23ce184B6A78bafD2A517DdE8n)` |

## ABI

### `CCIPRouterABI`

`import CCIPRouterABI from "./protocols/chainlink-ccip/CCIPRouterABI.json";` Speaks for: router.

- `ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32 messageId)`
- `getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256 fee)`
- `isChainSupported(uint64 chainSelector) view returns (bool)`
