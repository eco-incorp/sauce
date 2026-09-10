# Frax Ether

Frax Finance's liquid staking derivative. Two tokens: frxETH (pegged 1:1 to ETH) and sfrxETH (yield-bearing ERC-4626 vault token that accrues staking yield).

## Category

liquid-staking | Chains: Ethereum

## Key Operations

- **submitAndDeposit**: Stake ETH and deposit directly into sfrxETH vault (one-step)
- **deposit**: Deposit frxETH into sfrxETH vault
- **redeem**: Redeem sfrxETH shares for frxETH

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/frax-ether";
```

## SauceScript Examples

```typescript
// Stake ETH and get sfrxETH directly
import { FrxETHMinterABI as IFrxETHMinter } from "./abis";
function main(minterAddress: Address, recipient: Address): Uint256 {
  const minter = IFrxETHMinter.at(minterAddress);
  return minter.submitAndDeposit(recipient);
}

// Deposit frxETH into sfrxETH vault
import { SfrxETHABI as ISfrxETH } from "./abis";
function main(sfrxethAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const sfrxeth = ISfrxETH.at(sfrxethAddress);
  return sfrxeth.deposit(assets, receiver);
}

// Redeem sfrxETH for frxETH
import { SfrxETHABI as ISfrxETH } from "./abis";
function main(
  sfrxethAddress: Address,
  shares: Uint256,
  receiver: Address,
  owner: Address,
): Uint256 {
  const sfrxeth = ISfrxETH.at(sfrxethAddress);
  return sfrxeth.redeem(shares, receiver, owner);
}
```

## Key Addresses

| Chain    | Contract     | Address                                      |
| -------- | ------------ | -------------------------------------------- |
| Ethereum | sfrxETH      | `0xac3E018457B222d93114458476f3E3416Abbe38F` |
| Ethereum | frxETHMinter | `0xbAFA44EFE7901E04E39Dad13167D089C559c1138` |

## ABI Methods

### FrxETHMinterABI

- `submitAndDeposit(address)` - Stake ETH (payable) and auto-deposit into sfrxETH vault. Returns sfrxETH shares

### SfrxETHABI (ERC-4626)

- `deposit(uint256,address)` - Deposit frxETH, receive sfrxETH shares
- `redeem(uint256,address,address)` - Redeem sfrxETH shares for frxETH. Params: shares, receiver, owner
- `convertToShares(uint256)` - Preview shares for frxETH amount
- `convertToAssets(uint256)` - Preview frxETH for sfrxETH amount
- `balanceOf(address)` - Query sfrxETH balance

## Notes

- TVL: $700M+. sfrxETH is ERC-4626 compliant (same interface as Yearn V3, pufETH)
- submitAndDeposit() is payable - send ETH as msg.value. One-step ETH -> sfrxETH
- frxETH does not earn yield on its own - must be deposited into sfrxETH vault
- Approve frxETH to sfrxETH contract before calling deposit()
