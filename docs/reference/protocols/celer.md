<!-- Generated from the SDK's registries. Do not edit. -->

# Celer Network (`celer`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Celer Network is a bridge: it moves tokens from one chain to another. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Multi-chain bridging protocol using SGN (State Guardian Network) for cross-chain message validation and token transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Celer` on ethereum, optimism, bsc, polygon, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, arbitrum, avalanche |

## Notes

- `send` for ERC-20 tokens, `sendNative` for native tokens (ETH, BNB, AVAX, etc.)
- `nonce` is used for unique transfer identification -- can set to 0 or use block.timestamp
- `maxSlippage` is in basis points (1 = 0.01%, 100 = 1%, 5000 = 50%)
- Uses SGN validators to verify cross-chain messages
- Finality: typically 5-20 minutes depending on chain confirmation requirements
- Requires ERC-20 approval to the Bridge address
- TVL: $150M+. Audited

## Its names in a program

On Ethereum, `Celer` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's bridge, `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820`.
  require(Celer.Bridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | bridge | `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820` | `Celer.Bridge` |
| [Optimism](../chains/optimism.md) | bridge | `0x9D39Fc627A6d9d9F8C831c16995b209548cc3401` | `Celer.Bridge` |
| [BNB Chain](../chains/bsc.md) | bridge | `0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF` | `Celer.Bridge` |
| [Polygon](../chains/polygon.md) | bridge | `0x88DCDC47D2f83a99CF0000FDF667A468bB958a78` | `Celer.Bridge` |
| [Arbitrum One](../chains/arbitrum.md) | bridge | `0x1619DE6B6B20eD217a58d00f37B9d47C7663feca` | `Celer.Bridge` |
| [Avalanche C-Chain](../chains/avalanche.md) | bridge | `0xef3c714c9425a8F3697A9C969Dc1af30ba82e5d4` | `Celer.Bridge` |

## ABI

### `CelerBridgeABI`

`import CelerBridgeABI from "./protocols/celer/CelerBridgeABI.json";` Speaks for: bridge.

- `send(address _receiver, address _token, uint256 _amount, uint64 _dstChainId, uint64 _nonce, uint32 _maxSlippage)`
- `sendNative(address _receiver, uint256 _amount, uint64 _dstChainId, uint64 _nonce, uint32 _maxSlippage) payable`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
