<!-- Generated from the SDK's registries. Do not edit. -->

# Squid Router (`squid`)

Cross-chain liquidity router built on Axelar. Enables one-click cross-chain swaps combining bridge and DEX operations.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [squid.md](../squid.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's squidRouter):

```sauce chain=ethereum
import SquidRouterABI from "./protocols/squid/SquidRouterABI.json";

const SQUID_ROUTER = 0xce16F69375520ab01377ce7B88f5BA8C48F8D666n;

function main() {
  const bound = SquidRouterABI.at(SQUID_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |
| [Base](../../../sauce-chains/references/base.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |

## ABI

### `SquidRouterABI`

`import SquidRouterABI from "./protocols/squid/SquidRouterABI.json";` Speaks for: squidRouter.

- `bridgeCall(string bridgedTokenSymbol, uint256 amount, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress) payable`
- `callBridgeCall(address token, uint256 amount, (uint8 callType, address target, uint256 value, bytes callData, bytes payload)[] calls, string bridgedTokenSymbol, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress) payable`
