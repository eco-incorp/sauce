# Alchemix

Self-repaying loan protocol. Deposit yield-bearing collateral to borrow synthetic assets (alUSD, alETH) that repay themselves over time via yield.

## Category

cdp | Chains: Ethereum

## Key Operations

- **deposit**: Deposit yield-bearing token as collateral
- **withdraw**: Withdraw collateral
- **mint**: Borrow synthetic asset (alUSD or alETH) against collateral
- **burn**: Repay synthetic asset debt

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/alchemix";
```

## SauceScript Examples

```typescript
// Deposit yield-bearing collateral
import { AlchemistABI as IAlchemist } from "./abis";
function main(
  alchemistAddress: Address,
  yieldToken: Address,
  amount: Uint256,
  recipient: Address,
): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.deposit(yieldToken, amount, recipient);
}

// Withdraw collateral
import { AlchemistABI as IAlchemist } from "./abis";
function main(
  alchemistAddress: Address,
  yieldToken: Address,
  shares: Uint256,
  recipient: Address,
): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.withdraw(yieldToken, shares, recipient);
}

// Borrow (mint) synthetic asset
import { AlchemistABI as IAlchemist } from "./abis";
function main(alchemistAddress: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  alchemist.mint(amount, recipient);
  return 1;
}

// Repay (burn) synthetic asset
import { AlchemistABI as IAlchemist } from "./abis";
function main(alchemistAddress: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.burn(amount, recipient);
}
```

## Key Addresses

| Chain    | Contract       | Address                                      |
| -------- | -------------- | -------------------------------------------- |
| Ethereum | alchemistAlUSD | `0x5C6374a2ac4EBC38DeA0Fc1F8716e5Ea1ADD94dd` |
| Ethereum | alchemistAlETH | `0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5c` |
| Ethereum | alUSD          | `0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9` |
| Ethereum | alETH          | `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6` |

## ABI Methods

### AlchemistABI

- `deposit(address,uint256,address)` - Deposit yield-bearing collateral. Params: yieldToken (e.g. yvDAI, yvUSDC), amount, recipient. Returns shares
- `withdraw(address,uint256,address)` - Withdraw collateral. Params: yieldToken, shares (deposit shares to burn), recipient. Returns amountWithdrawn
- `mint(uint256,address)` - Borrow synthetic asset. Params: amount (alUSD/alETH to mint), recipient. Max borrow = 50% of collateral value
- `burn(uint256,address)` - Repay debt by burning synthetic. Params: amount (alUSD/alETH to burn), recipient (whose debt to repay). Returns uint256
- `liquidate(address,uint256,uint256)` - Liquidate undercollateralized position. Params: yieldToken, shares, minimumAmountOut. Returns uint256
- `accounts(address)` - Query account info. Params: owner. Returns (debt as int256, depositedTokens as address[])

## Notes

- Self-repaying: yield from deposited collateral automatically reduces debt over time
- Two Alchemist contracts: alchemistAlUSD (for USD synthetics) and alchemistAlETH (for ETH synthetics)
- Max LTV: 50% - can borrow up to half the value of deposited collateral
- yieldToken is the yield-bearing version (e.g. yvDAI, aDAI, stETH), not the base token
- Approve yieldToken to the appropriate Alchemist contract before depositing
- debt is int256 because it can be negative (overpaid/surplus)
