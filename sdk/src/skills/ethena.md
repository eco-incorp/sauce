# Ethena

Synthetic dollar protocol providing USDe, a crypto-native dollar backed by delta-neutral positions. sUSDe offers yield from staking and funding rates.

## Category

cdp | Chains: Ethereum

## Key Operations

- **stakeUSDe**: Stake USDe to receive sUSDe (yield-bearing)
- **cooldownAssets**: Start cooldown period to unstake (by asset amount)
- **cooldownShares**: Start cooldown period to unstake (by share amount)
- **unstake**: Complete unstake after cooldown period

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/ethena";
```

## SauceScript Examples

```typescript
// Stake USDe for sUSDe
import { StakedUSDeABI as IStakedUSDe } from "./abis";
function main(susdeAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  return susde.deposit(amount, receiver);
}

// Start cooldown to unstake
import { StakedUSDeABI as IStakedUSDe } from "./abis";
function main(susdeAddress: Address, assets: Uint256): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  return susde.cooldownAssets(assets);
}

// Complete unstake after cooldown
import { StakedUSDeABI as IStakedUSDe } from "./abis";
function main(susdeAddress: Address, receiver: Address): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  susde.unstake(receiver);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | usde     | `0x4c9EDD5852cd905f086C759E8383e09bff1e68b3` |
| Ethereum | susde    | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` |

## ABI Methods

### StakedUSDeABI (ERC-4626 + cooldown)

- `deposit(uint256,address)` - Stake USDe, receive sUSDe. Params: assets (USDe amount), receiver. Returns shares (sUSDe minted)
- `withdraw(uint256,address,address)` - Withdraw by asset amount (after cooldown). Params: assets, receiver, owner. Returns shares burned
- `redeem(uint256,address,address)` - Redeem by share amount (after cooldown). Params: shares, receiver, owner. Returns assets
- `cooldownAssets(uint256)` - Start cooldown by specifying USDe amount. Params: assets. Returns shares that will be burned
- `cooldownShares(uint256)` - Start cooldown by specifying sUSDe amount. Params: shares. Returns assets that will be received
- `unstake(address)` - Complete unstake after cooldown. Params: receiver (address to receive USDe)

### USDeABI

- `approve(address,uint256)` - Approve USDe spender. Params: spender, amount. Returns bool

## Notes

- TVL: $3B+. Yield comes from ETH staking rewards + perpetual funding rates
- 7-day cooldown period required before unstaking
- Flow: deposit (stake) -> cooldownAssets/cooldownShares (start cooldown) -> unstake (after 7 days)
- Approve USDe to sUSDe contract before depositing
- sUSDe appreciates against USDe as yield accrues
