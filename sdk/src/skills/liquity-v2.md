# Liquity V2

Next generation of Liquity protocol with user-set interest rates, multi-collateral support, and the BOLD stablecoin.

## Category

cdp | Chains: Ethereum

## Key Operations

- **transfer**: Transfer BOLD tokens
- **approve**: Approve BOLD token spender

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/liquity-v2";
```

## SauceScript Examples

```typescript
// Transfer BOLD
import { BoldTokenABI as IBoldToken } from "./abis";
function main(boldAddress: Address, to: Address, amount: Uint256): Uint256 {
  const bold = IBoldToken.at(boldAddress);
  bold.transfer(to, amount);
  return 1;
}

// Approve BOLD spender
import { BoldTokenABI as IBoldToken } from "./abis";
function main(boldAddress: Address, spender: Address, amount: Uint256): Uint256 {
  const bold = IBoldToken.at(boldAddress);
  bold.approve(spender, amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | bold     | `0x6440f144b7e50D6a8439336510312d2F54beB01D` |

## ABI Methods

### BoldTokenABI

- `transfer(address,uint256)` - Transfer BOLD tokens. Params: to, amount. Returns bool
- `approve(address,uint256)` - Approve spender. Params: spender, amount. Returns bool
- `balanceOf(address)` - Query balance. Params: account. Returns uint256

## Notes

- User-set interest rates - borrowers choose their own rate (higher rate = lower liquidation risk)
- Multi-collateral: ETH, wstETH, rETH, and other LSTs
- BOLD is fully redeemable 1:1 for collateral at any time
- Successor to Liquity V1 with improved capital efficiency
