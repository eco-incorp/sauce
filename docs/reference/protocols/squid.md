<!-- Generated from the SDK's registries. Do not edit. -->

# Squid Router (`squid`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Squid Router is a bridge: it moves tokens from one chain to another. This page lists the chains it
> is deployed on, the name a program writes for each of its contracts, and the functions a program
> can call.

Cross-chain liquidity router built on Axelar. Enables one-click cross-chain swaps combining bridge and DEX operations.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Squid` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## Notes

- Built on Axelar GMP -- uses Axelar chain name strings for destination (e.g. "ethereum", "arbitrum", "Polygon")
- `bridgeCall` for simple token bridges; `callBridgeCall` for swap-then-bridge (includes pre-bridge DEX swaps)
- Same Router address (`0xce16F6...`) deployed across all supported chains
- `bridgedTokenSymbol` must match the Axelar-registered symbol for the bridged asset
- The `payload` parameter enables post-bridge execution on the destination chain
- `callBridgeCall`'s `calls` array allows chaining multiple swap steps before the bridge
- Requires ERC-20 approval to the Squid Router address
- Finality: 2-5 minutes (depends on Axelar validator consensus)
- TVL: $100M+. Audited

## Its names in a program

On Ethereum, `Squid` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's squidRouter, `0xce16F69375520ab01377ce7B88f5BA8C48F8D666`.
  require(Squid.SquidRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Optimism](../chains/optimism.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [BNB Chain](../chains/bsc.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Polygon](../chains/polygon.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Base](../chains/base.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Arbitrum One](../chains/arbitrum.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Avalanche C-Chain](../chains/avalanche.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |

## ABI

### `SquidRouterABI`

`import SquidRouterABI from "./protocols/squid/SquidRouterABI.json";` Speaks for: squidRouter.

- `bridgeCall(string bridgedTokenSymbol, uint256 amount, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress) payable`
- `callBridgeCall(address token, uint256 amount, (uint8 callType, address target, uint256 value, bytes callData, bytes payload)[] calls, string bridgedTokenSymbol, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress) payable`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
