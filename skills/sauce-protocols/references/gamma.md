# Gamma Strategies

Active concentrated liquidity management protocol. Manages Uniswap V3, Algebra, and other CL DEX positions with automated rebalancing via Hypervisor vaults.

## Category

yield | Chains: Ethereum, Polygon

## Key Operations

- **deposit**: Deposit token pair into Gamma Hypervisor via UniProxy
- **withdraw**: Withdraw liquidity from Hypervisor

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  deposit,
  depositLegacy,
  withdraw,
} from "@eco-incorp/sauce/protocols/gamma";
```

## SauceScript Examples

```typescript
// Deposit into Gamma Hypervisor
import { UniProxyABI as IUniProxy } from "./abis";
function main(
  uniProxyAddress: Address,
  deposit0: Uint256,
  deposit1: Uint256,
  to: Address,
  pos: Address,
): Uint256 {
  const proxy = IUniProxy.at(uniProxyAddress);
  return proxy.deposit(deposit0, deposit1, to, pos, [0, 0, 0, 0]);
}

// Withdraw from Hypervisor
import { HypervisorABI as IHypervisor } from "./abis";
function main(hypervisorAddress: Address, shares: Uint256, to: Address, from: Address): Uint256 {
  const hv = IHypervisor.at(hypervisorAddress);
  hv.withdraw(shares, to, from, [0, 0, 0, 0]);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                                                                   |
| -------- | -------- | ----------------------------------------------------------------------------------------- |
| Ethereum | uniProxy | `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599` (an older UniProxy: use `UniProxyLegacyABI`) |
| Polygon  | uniProxy | `0xA42d55074869491D60Ac05490376B74cF19B00e6`                                              |

## ABI Methods

### UniProxyABI

- `deposit(uint256,uint256,address,address,uint256[4])` - Deposit tokens. Params: deposit0, deposit1, to (receiver), pos (hypervisor address), minIn[4] (slippage, use [0,0,0,0])
- `getDepositAmount(address,address,uint256)` - Preview required token1 amount for given token0 deposit. Params: pos, token, deposit amount. Returns (amountStart, amountEnd)

### UniProxyLegacyABI

The Ethereum UniProxy is an older deployment; its `deposit` has no `minIn` (the `depositLegacy` template calls it).

- `deposit(uint256,uint256,address,address)` - Deposit tokens. Params: deposit0, deposit1, to (receiver), pos (hypervisor address). Returns shares
- `getDepositAmount(address,address,uint256)` - As on the current UniProxy

### HypervisorABI

- `withdraw(uint256,address,address,uint256[4])` - Withdraw by burning shares. Params: shares, to, from, minAmounts[4]. Returns (amount0, amount1)
- `balanceOf(address)` - Query Hypervisor share balance
- `totalSupply()` - Total shares outstanding
- `getTotalAmounts()` - Total (amount0, amount1) managed

## Notes

- TVL: $200M+. Each Hypervisor is a vault for a specific token pair
- Deposit via UniProxy (not directly on Hypervisor) - UniProxy handles deposit ratio enforcement
- Use getDepositAmount() to find correct token1 amount for your token0 deposit
- The uint256[4] minIn/minAmounts array provides slippage protection (use zeros for no limit)
- Approve both token0 and token1 to UniProxy before depositing
