# Squid Router

Cross-chain liquidity router built on Axelar. Enables one-click cross-chain swaps combining bridge and DEX operations.

## Category
bridge aggregator | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), BSC (56), Avalanche (43114)

## SauceScript Functions

### bridge
Bridge tokens cross-chain via Squid Router.
```typescript
import { SquidRouterABI as ISquidRouter } from "./abis";

function main(routerAddress: Address, token: Address, amount: Uint256, bridgedTokenSymbol: string, destinationChain: string, destinationAddress: string): Uint256 {
  const router = ISquidRouter.at(routerAddress);
  router.callBridge(token, amount, bridgedTokenSymbol, destinationChain, destinationAddress, 0x00);
  return 1;
}
```
- `token`: ERC-20 token address to bridge on source chain
- `amount`: Amount of tokens to bridge
- `bridgedTokenSymbol`: Symbol of the bridged token on Axelar (e.g. "axlUSDC", "WETH")
- `destinationChain`: Axelar chain name string (e.g. "ethereum", "arbitrum", "Polygon")
- `destinationAddress`: Recipient address on the destination chain (as string)
- `payload`: Optional calldata to execute on destination. `0x00` for simple transfers
- Requires ERC-20 approval to the Squid Router

## Deployed Addresses

| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Arbitrum | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Optimism | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Base | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Polygon | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| BSC | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Avalanche | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |

## ABI Reference

### SquidRouterABI
- `bridgeCall(address token, uint256 amount, ISquidMulticall.Call[] calls, string bridgedTokenSymbol, string destinationChain, string destinationAddress)` [payable] - Bridge with pre-bridge swap steps. `calls` is an array of swap operations to execute before bridging
- `callBridge(address token, uint256 amount, string bridgedTokenSymbol, string destinationChain, string destinationAddress, bytes payload)` [payable] - Simple bridge without pre-bridge swaps. `payload` is optional calldata for destination execution

ISquidMulticall.Call tuple: `(uint8 callType, address target, uint256 value, bytes callData, bytes payload)`

## Notes
- Built on Axelar GMP -- uses Axelar chain name strings for destination (e.g. "ethereum", "arbitrum", "Polygon")
- `callBridge` for simple token bridges; `bridgeCall` for swap-then-bridge (includes pre-bridge DEX swaps)
- Same Router address (`0xce16F6...`) deployed across all supported chains
- `bridgedTokenSymbol` must match the Axelar-registered symbol for the bridged asset
- The `payload` parameter in `callBridge` enables post-bridge execution on the destination chain
- `bridgeCall`'s `calls` array allows chaining multiple swap steps before the bridge
- Requires ERC-20 approval to the Squid Router address
- Finality: 2-5 minutes (depends on Axelar validator consensus)
- TVL: $100M+. Audited
