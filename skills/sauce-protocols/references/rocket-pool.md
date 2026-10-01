# Rocket Pool

Decentralised Ethereum liquid staking protocol. Stake ETH and receive rETH, a non-rebasing liquid staking token backed by a decentralized network of permissionless node operators.

## Category

liquid-staking | Chains: Ethereum

## Key Operations

- **deposit**: Stake ETH and receive rETH
- **burn**: Burn rETH to redeem ETH (subject to pool liquidity)

## SDK Usage

```typescript
import { protocolInfo, deployments, deposit, burn } from "@eco-incorp/sauce/protocols/rocket-pool";
```

## SauceScript Examples

```typescript
// Deposit ETH for rETH
import { RocketDepositPoolABI as IRocketDepositPool } from "./abis";
function main(depositPoolAddress: Address): Uint256 {
  const pool = IRocketDepositPool.at(depositPoolAddress);
  pool.deposit();
  return 1;
}

// Burn rETH back to ETH
import { RETHABI as IRETH } from "./abis";
function main(rethAddress: Address, amount: Uint256): Uint256 {
  const reth = IRETH.at(rethAddress);
  reth.burn(amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract          | Address                                      |
| -------- | ----------------- | -------------------------------------------- |
| Ethereum | rETH              | `0xae78736Cd615f374D3085123A210448E74Fc6393` |
| Ethereum | rocketDepositPool | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` |

## ABI Methods

### RocketDepositPoolABI

- `deposit()` - Stake ETH (payable), receive rETH. Send ETH as msg.value

### RETHABI

- `getExchangeRate()` - Current rETH/ETH exchange rate (18 decimals)
- `getRethValue(uint256)` - Convert ETH amount to rETH equivalent
- `getEthValue(uint256)` - Convert rETH amount to ETH equivalent
- `burn(uint256)` - Burn rETH to receive ETH. May fail if insufficient deposit pool liquidity
- `balanceOf(address)` - Query rETH balance

## Notes

- TVL: $3B+. Most decentralized LST with permissionless node operators
- rETH is non-rebasing: value increases over time relative to ETH
- deposit() is payable - send ETH as msg.value, no parameters needed
- burn() may fail if insufficient liquidity in the deposit pool
- Exchange rate only goes up (barring slashing events)
