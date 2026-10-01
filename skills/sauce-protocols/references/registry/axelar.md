<!-- Generated from the SDK's registries. Do not edit. -->

# Axelar (`axelar`)

Universal cross-chain communication protocol with decentralized validator set. Supports GMP (General Message Passing) and ITS (Interchain Token Service).

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, polygon, base, arbitrum, avalanche |
| Document | [axelar.md](../axelar.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's gasService):

```sauce chain=ethereum
import AxelarGasServiceABI from "./protocols/axelar/AxelarGasServiceABI.json";

const GAS_SERVICE = 0x2d5d7d31F671F86C782533cc367F14109a082712n;

function main() {
  const bound = AxelarGasServiceABI.at(GAS_SERVICE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gasService | `0x2d5d7d31F671F86C782533cc367F14109a082712` | `AxelarGasServiceABI.at(0x2d5d7d31F671F86C782533cc367F14109a082712n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gateway | `0x4F4495243837681061C4743b74B3eEdf548D56A5` | `AxelarGatewayABI.at(0x4F4495243837681061C4743b74B3eEdf548D56A5n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `AxelarITSABI.at(0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3Cn)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `AxelarGatewayABI.at(0xe432150cce91c13a887f7D836923d5597adD8E31n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `AxelarITSABI.at(0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3Cn)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | gateway | `0x6f015F16De9fC8791b234eF68D486d2bF203FBA8` | `AxelarGatewayABI.at(0x6f015F16De9fC8791b234eF68D486d2bF203FBA8n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `AxelarITSABI.at(0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3Cn)` |
| [Base](../../../sauce-chains/references/base.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `AxelarGatewayABI.at(0xe432150cce91c13a887f7D836923d5597adD8E31n)` |
| [Base](../../../sauce-chains/references/base.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `AxelarITSABI.at(0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3Cn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `AxelarGatewayABI.at(0xe432150cce91c13a887f7D836923d5597adD8E31n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `AxelarITSABI.at(0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3Cn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | gateway | `0x5029C0EFf6C34351a0CEc334542cDb22c7928f78` | `AxelarGatewayABI.at(0x5029C0EFf6C34351a0CEc334542cDb22c7928f78n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `AxelarITSABI.at(0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3Cn)` |

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
