# Squid Router

Cross-chain liquidity router built on Axelar. Enables one-click cross-chain swaps combining bridge and DEX operations.

## Category

bridge aggregator | Direction: any-to-any | Chains and addresses: [registry/squid.md](registry/squid.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/squid.md](registry/squid.md).

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
