# crvUSD

Curve Finance native stablecoin using LLAMMA (Lending-Liquidating AMM Algorithm) for soft liquidations.

## Category

cdp | Chains: Ethereum

## Key Operations

- **transfer**: Transfer crvUSD tokens
- **approve**: Approve crvUSD token spender

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/crvusd";
```

## SauceScript Examples

```typescript
// Transfer crvUSD
import { CrvUSDERC20ABI as ICrvUSD } from "./abis";
function main(crvusdAddress: Address, to: Address, amount: Uint256): Uint256 {
  const crvusd = ICrvUSD.at(crvusdAddress);
  return crvusd.transfer(to, amount);
}

// Approve crvUSD spender
import { CrvUSDERC20ABI as ICrvUSD } from "./abis";
function main(crvusdAddress: Address, spender: Address, amount: Uint256): Uint256 {
  const crvusd = ICrvUSD.at(crvusdAddress);
  return crvusd.approve(spender, amount);
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | crvusd   | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` |

## ABI Methods

### CrvUSDERC20ABI

- `transfer(address,uint256)` - Transfer crvUSD. Params: to, amount. Returns bool
- `approve(address,uint256)` - Approve spender. Params: spender, amount. Returns bool
- `balanceOf(address)` - Query balance. Params: account. Returns uint256

## Notes

- TVL: $500M+. LLAMMA provides soft liquidations - collateral gradually converted to crvUSD during price drops
- Soft liquidation = collateral is progressively swapped rather than instant liquidation
- Borrowing happens through Curve lending controllers (per-market contracts)
- Supported collateral includes ETH, wstETH, sfrxETH, tBTC, wBTC
- crvUSD has a peg keeper mechanism to maintain $1 peg via Curve pools
