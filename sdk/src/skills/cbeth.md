# Coinbase Wrapped Staked ETH

Coinbase's liquid staking token for Ethereum. cbETH represents staked ETH plus accrued staking rewards. Non-rebasing.

## Category

liquid-staking | Chains: Ethereum, Base

## Key Operations

- **transfer**: Transfer cbETH tokens
- **approve**: Approve spender for cbETH

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/cbeth";
```

## SauceScript Examples

```typescript
// Transfer cbETH
import { CbETHABI as ICbETH } from "./abis";
function main(cbethAddress: Address, to: Address, amount: Uint256): Uint256 {
  const cbeth = ICbETH.at(cbethAddress);
  cbeth.transfer(to, amount);
  return 1;
}

// Approve cbETH
import { CbETHABI as ICbETH } from "./abis";
function main(cbethAddress: Address, spender: Address, amount: Uint256): Uint256 {
  const cbeth = ICbETH.at(cbethAddress);
  cbeth.approve(spender, amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | cbETH    | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` |
| Base     | cbETH    | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` |

## ABI Methods

### CbETHABI

- `mint(uint256)` - Mint cbETH (restricted to Coinbase)
- `exchangeRate()` - Current cbETH/ETH exchange rate
- `balanceOf(address)` - Query cbETH balance
- `approve(address,uint256)` - Approve spender
- `transfer(address,uint256)` - Transfer cbETH

## Notes

- TVL: $2.5B+. Non-rebasing - exchange rate increases over time
- Minted by Coinbase (mint is permissioned). On-chain operations are transfer/approve
- Compatible with EigenLayer restaking (cbETH strategy available)
- Available natively on Base L2
