# Circle Gateway

Circle's chain-abstracted USDC balance. Deposit USDC into the GatewayWallet on one chain, then mint it on another chain through the GatewayMinter with a Circle-signed attestation.

## Category

cross-chain | Chains: Ethereum (1), Optimism (10), Polygon (137), Unichain (130), Sonic (146), Sei (1329), Base (8453), Arbitrum (42161), Avalanche (43114), Arc (5042)

## SauceScript Functions

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

## Deployed Addresses

| Chain             | Contract      | Address                                      |
| ----------------- | ------------- | -------------------------------------------- |
| Every chain above | GatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` |
| Every chain above | GatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` |

| Chain     | Circle domain |
| --------- | ------------- |
| Ethereum  | 0             |
| Avalanche | 1             |
| Optimism  | 2             |
| Arbitrum  | 3             |
| Base      | 6             |
| Polygon   | 7             |
| Unichain  | 10            |
| Sonic     | 13            |
| Sei       | 16            |
| Arc       | 26            |

## ABI Reference

### GatewayWalletABI

- `deposit(address token, uint256 value)` - Deposit into the caller's own Gateway balance
- `depositFor(address token, address depositor, uint256 value)` - Deposit into another depositor's balance
- `totalBalance(address token, address depositor) returns (uint256)` - Available plus withdrawing (view)
- `availableBalance(address token, address depositor) returns (uint256)` - Spendable balance (view)
- `isTokenSupported(address token) returns (bool)` (view)
- `domain() returns (uint32)` - This chain's Circle domain, as in the table above (view)

### GatewayMinterABI

- `gatewayMint(bytes attestationPayload, bytes signature)` - Mint from a Circle-signed attestation
- `isTokenSupported(address token) returns (bool)` (view)
- `domain() returns (uint32)` (view)

## Notes

- Gateway uses Circle domain ids, the same ids as CCTP (Arc is 26), not EVM chain ids
- Spending a Gateway balance on another chain is off-chain first: sign a burn intent, submit it to Circle's Gateway API, then call `gatewayMint` with the returned attestation
- Both contracts are upgradeable (EIP-1967) proxies. Arc's Minter runs a different, smaller implementation from the other chains' that dispatches the same functions
- Circle also runs Gateway on HyperEVM (domain 19) and World Chain (14), which are not SDK chains. It has no Solana mainnet deployment
