<!-- Generated from the SDK's registries. Do not edit. -->

# Celer Network (`celer`)

Multi-chain bridging protocol using SGN (State Guardian Network) for cross-chain message validation and token transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Celer` on ethereum, optimism, bsc, polygon, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, arbitrum, avalanche |
| Document | [celer.md](../celer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Celer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's bridge, `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820`.
  require(Celer.Bridge != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bridge | `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820` | `Celer.Bridge` |
| [Optimism](../../../sauce-chains/references/optimism.md) | bridge | `0x9D39Fc627A6d9d9F8C831c16995b209548cc3401` | `Celer.Bridge` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | bridge | `0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF` | `Celer.Bridge` |
| [Polygon](../../../sauce-chains/references/polygon.md) | bridge | `0x88DCDC47D2f83a99CF0000FDF667A468bB958a78` | `Celer.Bridge` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | bridge | `0x1619DE6B6B20eD217a58d00f37B9d47C7663feca` | `Celer.Bridge` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | bridge | `0xef3c714c9425a8F3697A9C969Dc1af30ba82e5d4` | `Celer.Bridge` |

## ABI

### `CelerBridgeABI`

`import CelerBridgeABI from "./protocols/celer/CelerBridgeABI.json";` Speaks for: bridge.

- `send(address _receiver, address _token, uint256 _amount, uint64 _dstChainId, uint64 _nonce, uint32 _maxSlippage)`
- `sendNative(address _receiver, uint256 _amount, uint64 _dstChainId, uint64 _nonce, uint32 _maxSlippage) payable`
