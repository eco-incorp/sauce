<!-- Generated from the SDK's registries. Do not edit. -->

# Axelar (`axelar`)

Universal cross-chain communication protocol with decentralized validator set. Supports GMP (General Message Passing) and ITS (Interchain Token Service).

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Axelar` on ethereum, optimism, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, polygon, base, arbitrum, avalanche |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Uses chain name strings for destination (e.g. "ethereum", "arbitrum", "Polygon") -- NOT chain IDs
- `sendToken`: Simple token transfer. `callContract`: GMP message. `callContractWithToken`: Both
- GMP calls require pre-paying gas via GasService or including gasValue in ITS calls
- ITS (Interchain Token Service) enables native cross-chain tokens without wrapping
- Same ITS address (`0xB5FB...`) across all chains
- `tokenAddresses(symbol)` to look up the local address of an Axelar-supported token
- Finality: typically 2-5 minutes depending on source chain
- TVL: $800M+. Audited

## Its names in a program

On Ethereum, `Axelar` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's gasService, `0x2d5d7d31F671F86C782533cc367F14109a082712`.
  require(Axelar.GasService != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | gasService | `0x2d5d7d31F671F86C782533cc367F14109a082712` | `Axelar.GasService` |
| [Ethereum](../chains/ethereum.md) | gateway | `0x4F4495243837681061C4743b74B3eEdf548D56A5` | `Axelar.Gateway` |
| [Ethereum](../chains/ethereum.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Optimism](../chains/optimism.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Optimism](../chains/optimism.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Polygon](../chains/polygon.md) | gateway | `0x6f015F16De9fC8791b234eF68D486d2bF203FBA8` | `Axelar.Gateway` |
| [Polygon](../chains/polygon.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Base](../chains/base.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Base](../chains/base.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Arbitrum One](../chains/arbitrum.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Arbitrum One](../chains/arbitrum.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Avalanche C-Chain](../chains/avalanche.md) | gateway | `0x5029C0EFf6C34351a0CEc334542cDb22c7928f78` | `Axelar.Gateway` |
| [Avalanche C-Chain](../chains/avalanche.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |

## ABI

### `AxelarGasServiceABI`

`import AxelarGasServiceABI from "./protocols/axelar/AxelarGasServiceABI.json";` Speaks for: gasService.

- `payNativeGasForContractCall(address sender, string destinationChain, string destinationAddress, bytes payload, address refundAddress) payable`

### `AxelarGatewayABI`

`import AxelarGatewayABI from "./protocols/axelar/AxelarGatewayABI.json";` Speaks for: gateway.

- `callContract(string destinationChain, string contractAddress, bytes payload)`
- `callContractWithToken(string destinationChain, string contractAddress, bytes payload, string symbol, uint256 amount)`
- `sendToken(string destinationChain, string destinationAddress, string symbol, uint256 amount)`
- `tokenAddresses(string symbol) view returns (address)`

### `AxelarITSABI`

`import AxelarITSABI from "./protocols/axelar/AxelarITSABI.json";` Speaks for: its.

- `interchainTransfer(bytes32 tokenId, string destinationChain, bytes destinationAddress, uint256 amount, bytes metadata, uint256 gasValue) payable`
