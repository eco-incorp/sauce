# Swell

Liquid staking and restaking protocol for Ethereum. Offers swETH for liquid staking and rswETH for liquid restaking via EigenLayer.

## Category

liquid-staking | Chains: Ethereum

## Key Operations

- **stakeSwETH**: Deposit ETH for swETH (liquid staking)
- **stakeRswETH**: Deposit ETH for rswETH (liquid restaking)

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/swell";
```

## SauceScript Examples

```typescript
// Stake ETH for swETH
import { SwETHABI as ISwETH } from "./abis";
function main(swethAddress: Address): Uint256 {
  const sweth = ISwETH.at(swethAddress);
  return sweth.deposit();
}

// Stake ETH for rswETH (restaking)
import { RswETHABI as IRswETH } from "./abis";
function main(rswethAddress: Address): Uint256 {
  const rsweth = IRswETH.at(rswethAddress);
  return rsweth.deposit();
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | swETH    | `0xf951E335afb289353dc249e82926178EaC7DEd78` |
| Ethereum | rswETH   | `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0` |

## ABI Methods

### SwETHABI

- `deposit()` - Stake ETH (payable), receive swETH. Returns shares
- `swETHToETHRate()` - Current swETH/ETH exchange rate
- `balanceOf(address)` - Query swETH balance

### RswETHABI

- `deposit()` - Stake ETH (payable), receive rswETH. Returns shares
- `rswETHToETHRate()` - Current rswETH/ETH exchange rate
- `balanceOf(address)` - Query rswETH balance

## Notes

- TVL: $800M+. Both tokens are non-rebasing (value accrues)
- swETH = standard liquid staking. rswETH = liquid restaking via EigenLayer
- Both deposit() functions are payable - send ETH as msg.value
