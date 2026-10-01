<!-- Generated from the SDK's registries. Do not edit. -->

# Circle Gateway (`circle-gateway`)

Circle's chain-abstracted USDC balance. Deposit USDC into the GatewayWallet on one chain, then mint it on another through the GatewayMinter with a Circle-signed attestation.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche |
| Document | [circle-gateway.md](../circle-gateway.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's gatewayMinter):

```sauce chain=ethereum
import GatewayMinterABI from "./protocols/circle-gateway/GatewayMinterABI.json";

const GATEWAY_MINTER = 0x2222222d7164433c4C09B0b0D809a9b52C04C205n;

function main() {
  const bound = GatewayMinterABI.at(GATEWAY_MINTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Unichain](../../../sauce-chains/references/unichain.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Unichain](../../../sauce-chains/references/unichain.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Sonic](../../../sauce-chains/references/sonic.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Sonic](../../../sauce-chains/references/sonic.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Sei](../../../sauce-chains/references/sei.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Sei](../../../sauce-chains/references/sei.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Arc](../../../sauce-chains/references/arc.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Arc](../../../sauce-chains/references/arc.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Base](../../../sauce-chains/references/base.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Base](../../../sauce-chains/references/base.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |

## ABI

### `GatewayMinterABI`

`import GatewayMinterABI from "./protocols/circle-gateway/GatewayMinterABI.json";` Speaks for: gatewayMinter.

- `gatewayMint(bytes attestationPayload, bytes signature)`
- `isTokenSupported(address token) view returns (bool)`
- `domain() view returns (uint32)`

### `GatewayWalletABI`

`import GatewayWalletABI from "./protocols/circle-gateway/GatewayWalletABI.json";` Speaks for: gatewayWallet.

- `deposit(address token, uint256 value)`
- `depositFor(address token, address depositor, uint256 value)`
- `totalBalance(address token, address depositor) view returns (uint256)`
- `availableBalance(address token, address depositor) view returns (uint256)`
- `isTokenSupported(address token) view returns (bool)`
- `domain() view returns (uint32)`
