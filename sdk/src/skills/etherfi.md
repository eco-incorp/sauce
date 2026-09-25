# ether.fi

Decentralized, non-custodial liquid restaking protocol. Stake ETH to receive eETH (rebasing), or wrap it as weETH (non-rebasing) for DeFi composability. Natively restaked via EigenLayer.

## Category

restaking | Chains: Ethereum

## Key Operations

- **deposit**: Stake ETH and receive eETH
- **wrap**: Wrap eETH into weETH (non-rebasing)
- **unwrap**: Unwrap weETH back to eETH

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/etherfi";
```

## SauceScript Examples

```typescript
// Deposit ETH for eETH
import { LiquidityPoolABI as ILiquidityPool } from "./abis";
function main(liquidityPoolAddress: Address): Uint256 {
  const pool = ILiquidityPool.at(liquidityPoolAddress);
  return pool.deposit();
}

// Wrap eETH to weETH
import { WeETHABI as IWeETH } from "./abis";
function main(weethAddress: Address, amount: Uint256): Uint256 {
  const weeth = IWeETH.at(weethAddress);
  return weeth.wrap(amount);
}

// Unwrap weETH to eETH
import { WeETHABI as IWeETH } from "./abis";
function main(weethAddress: Address, amount: Uint256): Uint256 {
  const weeth = IWeETH.at(weethAddress);
  return weeth.unwrap(amount);
}
```

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| Ethereum | eETH          | `0x35fA164735182de50811E8e2E824cFb9B6118ac2` |
| Ethereum | weETH         | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` |
| Ethereum | liquidityPool | `0x308861A430be4cce5502d0A12724771Fc6DaF216` |

## ABI Methods

### LiquidityPoolABI

- `deposit()` - Stake ETH (payable), receive eETH. Returns shares minted

### WeETHABI

- `wrap(uint256)` - Wrap eETH amount into weETH. Requires eETH approval
- `unwrap(uint256)` - Unwrap weETH back to eETH
- `getEETHByWeETH(uint256)` - Preview eETH for weETH amount
- `getWeETHByEETH(uint256)` - Preview weETH for eETH amount
- `balanceOf(address)` - Query weETH balance

### EETHABI

- `balanceOf(address)` - Query eETH balance
- `approve(address,uint256)` - Approve eETH spending

## Notes

- TVL: $5.8B+. Largest liquid restaking protocol
- eETH rebases like stETH. Use weETH for DeFi (Aave, Pendle, etc.)
- deposit() is payable - send ETH as msg.value
- Approve eETH to weETH contract before wrapping
- Natively restaked on EigenLayer for additional AVS yield
