# Aevo

High-performance options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.

## Category

options | Chains and addresses: [registry/aevo.md](registry/aevo.md)

## Key Operations

- **depositERC20**: Deposit ERC-20 tokens into Aevo L2 for trading

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit ERC-20 into Aevo
import { DepositContractABI as IDeposit } from "./abis";
function main(
  depositAddress: Address,
  token: Address,
  l2Token: Address,
  amount: Uint256,
  minGasLimit: Uint256,
): Uint256 {
  const deposit = IDeposit.at(depositAddress);
  deposit.depositERC20(token, l2Token, amount, minGasLimit, "");
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/aevo.md](registry/aevo.md).

## Notes

- Custom OP Stack rollup with off-chain orderbook for sub-second matching
- Supports options and perpetual futures trading
- Deposits are on Ethereum L1, trading happens on Aevo L2
- Withdrawals processed by the rollup bridge (takes ~7 days for L2 to L1)
- Approve ERC-20 tokens to depositContract before calling depositERC20
- The deposit contract is Aevo's OP Stack `L1StandardBridge`, so these are the standard bridge entry points.
