<!-- Generated from the SDK's registries. Do not edit. -->

# Squid Router (`squid`)

Cross-chain liquidity router built on Axelar. Enables one-click cross-chain swaps combining bridge and DEX operations.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Squid` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [squid.md](../squid.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Squid` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's squidRouter, `0xce16F69375520ab01377ce7B88f5BA8C48F8D666`.
  require(Squid.SquidRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Polygon](../../../sauce-chains/references/polygon.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Base](../../../sauce-chains/references/base.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |

## ABI

### `SquidRouterABI`

`import SquidRouterABI from "./protocols/squid/SquidRouterABI.json";` Speaks for: squidRouter.

- `bridgeCall(string bridgedTokenSymbol, uint256 amount, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress) payable`
- `callBridgeCall(address token, uint256 amount, (uint8 callType, address target, uint256 value, bytes callData, bytes payload)[] calls, string bridgedTokenSymbol, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress) payable`
