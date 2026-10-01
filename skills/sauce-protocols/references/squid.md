# Squid Router

Cross-chain liquidity router built on Axelar. Enables one-click cross-chain swaps combining bridge and DEX operations.

## Category

bridge aggregator | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), BSC (56), Avalanche (43114)

## SauceScript Functions

### bridge

Bridge tokens cross-chain via Squid Router.

```typescript
import { SquidRouterABI as ISquidRouter } from "./abis";

function main(
  routerAddress: Address,
  amount: Uint256,
  bridgedTokenSymbol: string,
  destinationChain: string,
  destinationAddress: string,
  gasRefundRecipient: Address,
): Uint256 {
  const router = ISquidRouter.at(routerAddress);
  router.bridgeCall(
    bridgedTokenSymbol,
    amount,
    destinationChain,
    destinationAddress,
    "",
    gasRefundRecipient,
    false,
  );
  return 1;
}
```

- `amount`: Amount of tokens to bridge
- `bridgedTokenSymbol`: Symbol of the Axelar gateway token to bridge (e.g. "axlUSDC", "WETH"); it selects the token
- `destinationChain`: Axelar chain name string (e.g. "ethereum", "arbitrum", "Polygon")
- `destinationAddress`: Recipient address on the destination chain (as string)
- `payload` (5th argument): Optional calldata to execute on destination; empty for simple transfers
- `gasRefundRecipient`: receives unused Axelar gas; `enableExpress` (last) opts into express delivery
- Requires ERC-20 approval to the Squid Router

## Deployed Addresses

| Chain     | Contract    | Address                                      |
| --------- | ----------- | -------------------------------------------- |
| Ethereum  | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Arbitrum  | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Optimism  | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Base      | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Polygon   | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| BSC       | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |
| Avalanche | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` |

## ABI Reference

### SquidRouterABI

- `bridgeCall(string bridgedTokenSymbol, uint256 amount, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress)` [payable] - Bridge a gateway token by symbol, optionally executing `payload` on the destination
- `callBridgeCall(address token, uint256 amount, ISquidMulticall.Call[] calls, string bridgedTokenSymbol, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress)` [payable] - Run `calls` on the source chain (e.g. swap `token` into the bridged token), then bridge

ISquidMulticall.Call tuple: `(uint8 callType, address target, uint256 value, bytes callData, bytes payload)`

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
