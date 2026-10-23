<!-- Generated from the SDK's registries. Do not edit. -->

# Hop Protocol (`hop`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Hop Protocol is a bridge: it moves tokens from one chain to another. This page lists the chains it
> is deployed on, the name a program writes for each of its contracts, and the functions a program
> can call.

Token bridge for rollups using bonders for fast withdrawals. Supports ETH, USDC, USDT, DAI, and MATIC bridging across L2s.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Hop` on ethereum, optimism, polygon, base, arbitrum |
| Chains | ethereum, optimism, polygon, base, arbitrum |

## Notes

- L1-to-L2: Uses `sendToL2` on token-specific L1Bridge contracts
- L2-to-L2 or L2-to-L1: Uses `swapAndSend` on L2AmmWrapper (swaps canonical token to hToken for bridging)
- Each supported token has separate bridge contracts on L1 and AMM wrappers on L2
- Bonders provide fast liquidity on destination (minutes), settle via canonical bridge later
- `bonderFee` on L2 must be obtained from Hop API or SDK
- Finality: minutes with bonder, 7+ days without bonder (canonical path)
- TVL: $50M+. Audited

## Its names in a program

On Ethereum, `Hop` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's l1EthBridge, `0xb8901acB165ed027E32754E0FFe830802919727f`.
  require(Hop.L1EthBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | l1EthBridge | `0xb8901acB165ed027E32754E0FFe830802919727f` | `Hop.L1EthBridge` |
| [Ethereum](../chains/ethereum.md) | l1UsdcBridge | `0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a` | `Hop.L1UsdcBridge` |
| [Optimism](../chains/optimism.md) | l2AmmWrapper | `0x86cA30bEF97fB651b8d866D45503684b90cb3312` | `Hop.L2AmmWrapper` |
| [Polygon](../chains/polygon.md) | l2AmmWrapper | `0x76b22b8C1079A44F1211D867D68b1eda76a635A7` | `Hop.L2AmmWrapper` |
| [Base](../chains/base.md) | l2AmmWrapper | `0x10541b07d8Ad2647Dc6cD67abd4c03575dade261` | `Hop.L2AmmWrapper` |
| [Arbitrum One](../chains/arbitrum.md) | l2AmmWrapper | `0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417` | `Hop.L2AmmWrapper` |

## ABI

### `HopL1BridgeABI`

`import HopL1BridgeABI from "./protocols/hop/HopL1BridgeABI.json";` Speaks for: l1EthBridge, l1UsdcBridge.

- `sendToL2(uint256 chainId, address recipient, uint256 amount, uint256 amountOutMin, uint256 deadline, address relayer, uint256 relayerFee) payable`

### `HopL2AmmWrapperABI`

`import HopL2AmmWrapperABI from "./protocols/hop/HopL2AmmWrapperABI.json";` Speaks for: l2AmmWrapper.

- `swapAndSend(uint256 chainId, address recipient, uint256 amount, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 destinationAmountOutMin, uint256 destinationDeadline) payable`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
