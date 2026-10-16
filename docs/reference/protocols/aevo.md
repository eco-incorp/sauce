<!-- Generated from the SDK's registries. Do not edit. -->

# Aevo (`aevo`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aevo is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

High-performance options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Aevo` on ethereum |
| Chains | ethereum |

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

## Notes

- Custom OP Stack rollup with off-chain orderbook for sub-second matching
- Supports options and perpetual futures trading
- Deposits are on Ethereum L1, trading happens on Aevo L2
- Withdrawals processed by the rollup bridge (takes ~7 days for L2 to L1)
- Approve ERC-20 tokens to depositContract before calling depositERC20
- The deposit contract is Aevo's OP Stack `L1StandardBridge`, so these are the standard bridge entry points.

## Its names in a program

On Ethereum, `Aevo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's depositContract, `0x4082C9647c098a6493Fb499EaE63b5ce3259C574`.
  require(Aevo.DepositContract != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | depositContract | `0x4082C9647c098a6493Fb499EaE63b5ce3259C574` | `Aevo.DepositContract` |

## ABI

### `DepositContractABI`

`import DepositContractABI from "./protocols/aevo/DepositContractABI.json";` Speaks for: depositContract.

- `depositERC20(address l1Token, address l2Token, uint256 amount, uint32 minGasLimit, bytes extraData)`
- `depositETH(uint32 minGasLimit, bytes extraData) payable`
