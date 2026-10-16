<!-- Generated from the SDK's registries. Do not edit. -->

# Circle Gateway (`circle-gateway`)

> Circle Gateway is a messenger between chains: it carries messages and tokens from one to another.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Circle's chain-abstracted USDC balance. Deposit USDC into the GatewayWallet on one chain, then mint it on another chain through the GatewayMinter with a Circle-signed attestation.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `CircleGateway` on ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### deposit

Deposit a supported token (USDC) into the caller's Gateway balance.

```typescript
import { GatewayWalletABI as IGatewayWallet } from "./abis";

function main(walletAddress: Address, token: Address, amount: Uint256): Uint256 {
  const wallet = IGatewayWallet.at(walletAddress);
  wallet.deposit(token, amount);
  return 1;
}
```

- `token`: must satisfy `isTokenSupported(token)`: the chain's native (Circle-issued) USDC, which on Arc is USDC's ERC-20 interface `0x3600000000000000000000000000000000000000`
- `amount`: token units (6 decimals for USDC), never Arc's 18-decimal native units
- The depositor must first `approve` the GatewayWallet for `amount`

### availableBalance

Read the balance a depositor can spend through Gateway.

```typescript
import { GatewayWalletABI as IGatewayWallet } from "./abis";

function main(walletAddress: Address, token: Address, depositor: Address): Uint256 {
  const wallet = IGatewayWallet.at(walletAddress);
  return wallet.availableBalance(token, depositor);
}
```

### gatewayMint

Mint on the destination chain from an attestation Circle's Gateway API returned.

```typescript
import { GatewayMinterABI as IGatewayMinter } from "./abis";

function main(minterAddress: Address, attestationPayload: bytes, signature: bytes): Uint256 {
  const minter = IGatewayMinter.at(minterAddress);
  minter.gatewayMint(attestationPayload, signature);
  return 1;
}
```

## Notes

- Gateway uses Circle domain ids, the same ids as CCTP (Arc is 26), not EVM chain ids
- Spending a Gateway balance on another chain is off-chain first: sign a burn intent, submit it to Circle's Gateway API, then call `gatewayMint` with the returned attestation
- Both contracts are upgradeable (EIP-1967) proxies. Arc's Minter runs a different, smaller implementation from the other chains' that dispatches the same functions
- Circle also runs Gateway on HyperEVM (domain 19) and World Chain (14), which are not SDK chains. It has no Solana mainnet deployment

## Its names in a program

On Ethereum, `CircleGateway` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's gatewayMinter, `0x2222222d7164433c4C09B0b0D809a9b52C04C205`.
  require(CircleGateway.GatewayMinter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Ethereum](../chains/ethereum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Optimism](../chains/optimism.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Optimism](../chains/optimism.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Unichain](../chains/unichain.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Unichain](../chains/unichain.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Polygon](../chains/polygon.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Polygon](../chains/polygon.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Sonic](../chains/sonic.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Sonic](../chains/sonic.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Sei](../chains/sei.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Sei](../chains/sei.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Arc](../chains/arc.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Arc](../chains/arc.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Base](../chains/base.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Base](../chains/base.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Arbitrum One](../chains/arbitrum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Arbitrum One](../chains/arbitrum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Avalanche C-Chain](../chains/avalanche.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Avalanche C-Chain](../chains/avalanche.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |

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
