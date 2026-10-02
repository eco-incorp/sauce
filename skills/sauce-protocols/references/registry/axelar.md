<!-- Generated from the SDK's registries. Do not edit. -->

# Axelar (`axelar`)

Universal cross-chain communication protocol with decentralized validator set. Supports GMP (General Message Passing) and ITS (Interchain Token Service).

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Axelar` on ethereum, optimism, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, polygon, base, arbitrum, avalanche |
| Document | [axelar.md](../axelar.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Axelar` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's gasService, `0x2d5d7d31F671F86C782533cc367F14109a082712`.
  require(Axelar.GasService != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gasService | `0x2d5d7d31F671F86C782533cc367F14109a082712` | `Axelar.GasService` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gateway | `0x4F4495243837681061C4743b74B3eEdf548D56A5` | `Axelar.Gateway` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Optimism](../../../sauce-chains/references/optimism.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Optimism](../../../sauce-chains/references/optimism.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Polygon](../../../sauce-chains/references/polygon.md) | gateway | `0x6f015F16De9fC8791b234eF68D486d2bF203FBA8` | `Axelar.Gateway` |
| [Polygon](../../../sauce-chains/references/polygon.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Base](../../../sauce-chains/references/base.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Base](../../../sauce-chains/references/base.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | gateway | `0x5029C0EFf6C34351a0CEc334542cDb22c7928f78` | `Axelar.Gateway` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |

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
