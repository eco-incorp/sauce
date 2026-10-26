<!-- Generated from the SDK's registries. Do not edit. -->

# Aevo (`aevo`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aevo is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Aevo` on ethereum |
| Chains | ethereum |

## What it offers

- **depositERC20**: Deposit ERC-20 tokens into Aevo L2 for trading

## Notes

- Custom OP Stack rollup with off-chain orderbook for sub-second matching
- Supports options and perpetual futures trading
- Deposits are on Ethereum L1, trading happens on Aevo L2
- Withdrawals processed by the rollup bridge (takes ~7 days for L2 to L1)
- Approve ERC-20 tokens to depositContract before calling depositERC20
- The deposit contract is Aevo's OP Stack `L1StandardBridge`, so these are the standard bridge entry points.
- `depositERC20` and `depositETH` are for an externally owned account only: called from a contract, a Pot included, they revert with "StandardBridge: function can only be called from an EOA", so a Sauce program cannot deposit with `depositERC20`. The bridge's `depositERC20To(l1Token, l2Token, to, amount, minGasLimit, extraData)` takes a contract caller; the registry's ABI for Aevo does not declare it, so a program binds an ABI of its own for it

## Its names in a program

On Ethereum, `Aevo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's depositContract, `0x4082C9647c098a6493fb499EaE63b5ce3259c574`.
  require(Aevo.DepositContract != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | depositContract | `0x4082C9647c098a6493fb499EaE63b5ce3259c574` | `Aevo.DepositContract` |

## ABI

### `DepositContractABI`

`import DepositContractABI from "./protocols/aevo/DepositContractABI.json";` Speaks for: depositContract.

- `depositERC20(address l1Token, address l2Token, uint256 amount, uint32 minGasLimit, bytes extraData)`
- `depositETH(uint32 minGasLimit, bytes extraData) payable`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
