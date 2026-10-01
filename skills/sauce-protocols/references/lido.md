# Lido

The largest liquid staking protocol for Ethereum. Stake ETH and receive stETH, a rebasing liquid staking token. wstETH is the non-rebasing wrapped version for DeFi composability.

## Category

liquid-staking | Chains and addresses: [registry/lido.md](registry/lido.md)

## Key Operations

- **submit**: Stake ETH and receive stETH (rebasing)
- **wrap**: Wrap stETH into wstETH (non-rebasing, DeFi-compatible)
- **unwrap**: Unwrap wstETH back to stETH

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/lido.md](registry/lido.md).

## Notes

- TVL: $27.5B+. Largest DeFi protocol by TVL
- stETH rebases daily (balance increases). wstETH does not rebase (exchange rate increases instead)
- Always use wstETH for DeFi integrations (Aave, Uniswap, etc.) since rebasing tokens cause issues
- submit() requires ETH sent as msg.value. The referral parameter can be zero address
- Approve stETH to wstETH contract before calling wrap()
