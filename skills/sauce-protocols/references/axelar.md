# Axelar

Universal cross-chain communication protocol with decentralized validator set. Supports GMP (General Message Passing) and ITS (Interchain Token Service).

## Category

cross-chain messaging + bridge | Direction: any-to-any | Chains and addresses: [registry/axelar.md](registry/axelar.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### sendToken

Send tokens cross-chain via the Axelar Gateway.

```typescript
import { AxelarGatewayABI as IGateway } from "./abis";

function main(
  gatewayAddress: Address,
  destinationChain: string,
  destinationAddress: string,
  symbol: string,
  amount: Uint256,
): Uint256 {
  const gateway = IGateway.at(gatewayAddress);
  gateway.sendToken(destinationChain, destinationAddress, symbol, amount);
  return 1;
}
```

- `destinationChain`: Chain name as string (e.g. "ethereum", "arbitrum", "base")
- `destinationAddress`: Recipient address as string
- `symbol`: Token symbol as string (e.g. "axlUSDC", "WETH")
- Requires ERC-20 approval to the Gateway

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/axelar.md](registry/axelar.md).

## Notes

- Uses chain name strings for destination (e.g. "ethereum", "arbitrum", "Polygon") -- NOT chain IDs
- `sendToken`: Simple token transfer. `callContract`: GMP message. `callContractWithToken`: Both
- GMP calls require pre-paying gas via GasService or including gasValue in ITS calls
- ITS (Interchain Token Service) enables native cross-chain tokens without wrapping
- Same ITS address (`0xB5FB...`) across all chains
- `tokenAddresses(symbol)` to look up the local address of an Axelar-supported token
- Finality: typically 2-5 minutes depending on source chain
- TVL: $800M+. Audited
