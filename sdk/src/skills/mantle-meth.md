# Mantle mETH

Mantle's liquid staking token for Ethereum. Stake ETH and receive mETH, a non-rebasing token that accrues staking rewards over time.

## Category

liquid-staking | Chains: Ethereum

## Key Operations

- **stake**: Stake ETH for mETH with minimum output check

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/mantle-meth";
```

## SauceScript Examples

```typescript
// Stake ETH for mETH
import { METHABI as IMETH } from "./abis";
function main(methAddress: Address, minMETHAmount: Uint256): Uint256 {
  const meth = IMETH.at(methAddress);
  meth.stake(minMETHAmount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | mETH     | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` |

## ABI Methods

### METHABI

- `stake(uint256)` - Stake ETH (payable), receive mETH. Param: minMETHAmount for slippage protection
- `mETHToETH(uint256)` - Convert mETH amount to ETH value
- `ethToMETH(uint256)` - Convert ETH amount to mETH value
- `balanceOf(address)` - Query mETH balance
- `approve(address,uint256)` - Approve mETH spending

## Notes

- TVL: $1.5B+. Non-rebasing token backed by Mantle treasury
- stake() is payable - send ETH as msg.value
- minMETHAmount param provides slippage protection
- Use mETHToETH()/ethToMETH() to preview exchange rates
