# ether.fi

Decentralized, non-custodial liquid restaking protocol. Stake ETH to receive eETH (rebasing), or wrap it as weETH (non-rebasing) for DeFi composability. Natively restaked via EigenLayer.

## Category

restaking | Chains and addresses: [registry/etherfi.md](registry/etherfi.md)

## Key Operations

- **deposit**: Stake ETH and receive eETH
- **wrap**: Wrap eETH into weETH (non-rebasing)
- **unwrap**: Unwrap weETH back to eETH

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/etherfi.md](registry/etherfi.md).

## Notes

- TVL: $5.8B+. Largest liquid restaking protocol
- eETH rebases like stETH. Use weETH for DeFi (Aave, Pendle, etc.)
- deposit() is payable - send ETH as msg.value
- Approve eETH to weETH contract before wrapping
- Natively restaked on EigenLayer for additional AVS yield
