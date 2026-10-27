<!-- Generated from the SDK's registries. Do not edit. -->

# Circle Gateway (`circle-gateway`)

Circle's chain-abstracted USDC balance. Deposit USDC into the GatewayWallet on one chain, then mint it on another through the GatewayMinter with a Circle-signed attestation.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `CircleGateway` on ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche, base-sepolia, arc-testnet, sepolia |
| Chains | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche, base-sepolia, arc-testnet, sepolia |
| Document | [circle-gateway.md](../circle-gateway.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `CircleGateway` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's gatewayMinter, `0x2222222d7164433c4C09B0b0D809a9b52C04C205`.
  require(CircleGateway.GatewayMinter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Optimism](../../../sauce-chains/references/optimism.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Unichain](../../../sauce-chains/references/unichain.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Unichain](../../../sauce-chains/references/unichain.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Polygon](../../../sauce-chains/references/polygon.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Polygon](../../../sauce-chains/references/polygon.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Sonic](../../../sauce-chains/references/sonic.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Sonic](../../../sauce-chains/references/sonic.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Sei](../../../sauce-chains/references/sei.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Sei](../../../sauce-chains/references/sei.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Arc](../../../sauce-chains/references/arc.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Arc](../../../sauce-chains/references/arc.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Base](../../../sauce-chains/references/base.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Base](../../../sauce-chains/references/base.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Base Sepolia](../../../sauce-chains/references/base-sepolia.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Base Sepolia](../../../sauce-chains/references/base-sepolia.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
| [Arc Testnet](../../../sauce-chains/references/arc-testnet.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Arc Testnet](../../../sauce-chains/references/arc-testnet.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
| [Ethereum Sepolia](../../../sauce-chains/references/sepolia.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Ethereum Sepolia](../../../sauce-chains/references/sepolia.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |

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
