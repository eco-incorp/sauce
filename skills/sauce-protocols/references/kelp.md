# Kelp DAO

Liquid restaking protocol built on EigenLayer. Deposit LSTs (stETH, ETHx, etc.) and receive rsETH, a non-rebasing liquid restaked token.

## Category

restaking | Chains: Ethereum

## Key Operations

- **depositAsset**: Deposit LST to receive rsETH

## SDK Usage

```typescript
import { protocolInfo, deployments, depositAsset } from "@eco-incorp/sauce/protocols/kelp";
```

## SauceScript Examples

```typescript
// Deposit LST for rsETH
import { LRTDepositPoolABI as ILRTDepositPool } from "./abis";
function main(
  depositPoolAddress: Address,
  asset: Address,
  depositAmount: Uint256,
  minRSETHAmountExpected: Uint256,
): Uint256 {
  const pool = ILRTDepositPool.at(depositPoolAddress);
  pool.depositAsset(asset, depositAmount, minRSETHAmountExpected, "");
  return 1;
}
```

## Key Addresses

| Chain    | Contract       | Address                                      |
| -------- | -------------- | -------------------------------------------- |
| Ethereum | rsETH          | `0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7` |
| Ethereum | lrtDepositPool | `0x036676389e48133B63a802f8635AD39E752D375D` |

## ABI Methods

### LRTDepositPoolABI

- `depositAsset(address,uint256,uint256,string)` - Deposit LST for rsETH. Params: asset address, deposit amount, minimum rsETH expected, referral string (pass empty "")
- `getRsETHAmountToMint(address,uint256)` - Preview rsETH amount for a given LST deposit

### RsETHABI

- `balanceOf(address)` - Query rsETH balance
- `approve(address,uint256)` - Approve rsETH spending

## Notes

- TVL: $2B+. Accepts stETH, ETHx, and other LSTs
- Approve the LST to lrtDepositPool before depositing
- minRSETHAmountExpected provides slippage protection
- Use getRsETHAmountToMint() to preview output before depositing
