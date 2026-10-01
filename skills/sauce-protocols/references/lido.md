# Lido

The largest liquid staking protocol for Ethereum. Stake ETH and receive stETH, a rebasing liquid staking token. wstETH is the non-rebasing wrapped version for DeFi composability.

## Category

liquid-staking | Chains: Ethereum, Arbitrum

## Key Operations

- **submit**: Stake ETH and receive stETH (rebasing)
- **wrap**: Wrap stETH into wstETH (non-rebasing, DeFi-compatible)
- **unwrap**: Unwrap wstETH back to stETH

## SDK Usage

```typescript
import { protocolInfo, deployments, submit, wrap, unwrap } from "@eco-incorp/sauce/protocols/lido";
```

## SauceScript Examples

```typescript
// Stake ETH for stETH
import { LidoABI as ILido } from "./abis";
function main(lidoAddress: Address): Uint256 {
  const lido = ILido.at(lidoAddress);
  return lido.submit(0x0000000000000000000000000000000000000000);
}

// Wrap stETH to wstETH
import { WstETHABI as IWstETH } from "./abis";
function main(wstethAddress: Address, amount: Uint256): Uint256 {
  const wsteth = IWstETH.at(wstethAddress);
  return wsteth.wrap(amount);
}

// Unwrap wstETH to stETH
import { WstETHABI as IWstETH } from "./abis";
function main(wstethAddress: Address, amount: Uint256): Uint256 {
  const wsteth = IWstETH.at(wstethAddress);
  return wsteth.unwrap(amount);
}
```

## Key Addresses

| Chain    | Contract | Address                                                                                      |
| -------- | -------- | -------------------------------------------------------------------------------------------- |
| Ethereum | stETH    | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`                                                 |
| Ethereum | wstETH   | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`                                                 |
| Arbitrum | wstETH   | `0x5979D7b546E38E414F7E9822514be443A4800529` (bridged token: transfers only, no wrap/unwrap) |

## ABI Methods

### LidoABI (stETH)

- `submit(address)` - Stake ETH (payable), receive stETH. Address param is referral (use zero address). Send ETH as msg.value
- `balanceOf(address)` - Query stETH balance (rebases daily)
- `approve(address,uint256)` - Approve stETH spending

### WstETHABI

- `wrap(uint256)` - Wrap stETH amount into wstETH. Requires stETH approval first
- `unwrap(uint256)` - Unwrap wstETH amount back to stETH
- `getStETHByWstETH(uint256)` - Preview stETH amount for wstETH input
- `getWstETHByStETH(uint256)` - Preview wstETH amount for stETH input

## Notes

- TVL: $27.5B+. Largest DeFi protocol by TVL
- stETH rebases daily (balance increases). wstETH does not rebase (exchange rate increases instead)
- Always use wstETH for DeFi integrations (Aave, Uniswap, etc.) since rebasing tokens cause issues
- submit() requires ETH sent as msg.value. The referral parameter can be zero address
- Approve stETH to wstETH contract before calling wrap()
