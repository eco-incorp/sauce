<!-- Generated from the SDK's registries. Do not edit. -->

# Hop Protocol (`hop`)

Token bridge for rollups using bonders for fast withdrawals. Supports ETH, USDC, USDT, DAI, and MATIC bridging across L2s.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, polygon, base, arbitrum |
| Document | [hop.md](../hop.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's l1EthBridge):

```sauce chain=ethereum
import HopL1BridgeABI from "./protocols/hop/HopL1BridgeABI.json";

const L1_ETH_BRIDGE = 0xb8901acb165ed027e32754e0ffe830802919727fn;

function main() {
  const bound = HopL1BridgeABI.at(L1_ETH_BRIDGE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1EthBridge | `0xb8901acb165ed027e32754e0ffe830802919727f` | `HopL1BridgeABI.at(0xb8901acb165ed027e32754e0ffe830802919727fn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1UsdcBridge | `0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a` | `HopL1BridgeABI.at(0x3666f603Cc164936C1b87e207F36BEBa4AC5f18an)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | l2AmmWrapper | `0x86cA30bEF97fB651b8d866D45503684b90cb3312` | `HopL2AmmWrapperABI.at(0x86cA30bEF97fB651b8d866D45503684b90cb3312n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | l2AmmWrapper | `0x76b22b8C1079A44F1211D867D68b1eda76a635A7` | `HopL2AmmWrapperABI.at(0x76b22b8C1079A44F1211D867D68b1eda76a635A7n)` |
| [Base](../../../sauce-chains/references/base.md) | l2AmmWrapper | `0x10541b07d8Ad2647Dc6cD67abd4c03575dade261` | `HopL2AmmWrapperABI.at(0x10541b07d8Ad2647Dc6cD67abd4c03575dade261n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | l2AmmWrapper | `0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417` | `HopL2AmmWrapperABI.at(0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417n)` |

## ABI

### `HopL1BridgeABI`

`import HopL1BridgeABI from "./protocols/hop/HopL1BridgeABI.json";` Speaks for: l1EthBridge, l1UsdcBridge.

- `sendToL2(uint256 chainId, address recipient, uint256 amount, uint256 amountOutMin, uint256 deadline, address relayer, uint256 relayerFee) payable`

### `HopL2AmmWrapperABI`

`import HopL2AmmWrapperABI from "./protocols/hop/HopL2AmmWrapperABI.json";` Speaks for: l2AmmWrapper.

- `swapAndSend(uint256 chainId, address recipient, uint256 amount, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 destinationAmountOutMin, uint256 destinationDeadline) payable`
