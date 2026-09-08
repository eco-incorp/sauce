# Axelar

Universal cross-chain communication protocol with decentralized validator set. Supports GMP (General Message Passing) and ITS (Interchain Token Service).

## Category

cross-chain messaging + bridge | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), Avalanche (43114)

## SauceScript Functions

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

## Deployed Addresses

| Chain     | Contract   | Address                                      |
| --------- | ---------- | -------------------------------------------- |
| Ethereum  | gateway    | `0x4F4495243837681061C4743b74B3eEdf548D56A5` |
| Ethereum  | gasService | `0x2d5d7d31F671F86C782533cc367F14109a082712` |
| Ethereum  | its        | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| Arbitrum  | gateway    | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| Arbitrum  | its        | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| Optimism  | gateway    | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| Optimism  | its        | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| Base      | gateway    | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| Base      | its        | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| Polygon   | gateway    | `0x6f015F16De9fC8791b234eF68D486d2bF203FBA8` |
| Polygon   | its        | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |
| Avalanche | gateway    | `0x5029C0EFf6C34351a0CEc334542cDb22c7928f78` |
| Avalanche | its        | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` |

## ABI Reference

### AxelarGatewayABI

- `callContract(string destinationChain, string contractAddress, bytes payload)` - Send arbitrary message to destination contract (GMP)
- `callContractWithToken(string destinationChain, string contractAddress, bytes payload, string symbol, uint256 amount)` - Send message + tokens together
- `sendToken(string destinationChain, string destinationAddress, string symbol, uint256 amount)` - Send tokens to destination address
- `tokenAddresses(string symbol) returns (address)` - Look up token address by symbol (view)

### AxelarGasServiceABI

- `payNativeGasForContractCall(address sender, string destinationChain, string destinationAddress, bytes payload, address refundAddress)` [payable] - Pre-pay gas for GMP execution on destination chain

### AxelarITSABI

- `interchainTransfer(bytes32 tokenId, string destinationChain, bytes destinationAddress, uint256 amount, bytes metadata, uint256 gasValue)` [payable] - Transfer ITS-registered tokens cross-chain

## Notes

- Uses chain name strings for destination (e.g. "ethereum", "arbitrum", "Polygon") -- NOT chain IDs
- `sendToken`: Simple token transfer. `callContract`: GMP message. `callContractWithToken`: Both
- GMP calls require pre-paying gas via GasService or including gasValue in ITS calls
- ITS (Interchain Token Service) enables native cross-chain tokens without wrapping
- Same ITS address (`0xB5FB...`) across all chains
- `tokenAddresses(symbol)` to look up the local address of an Axelar-supported token
- Finality: typically 2-5 minutes depending on source chain
- TVL: $800M+. Audited
