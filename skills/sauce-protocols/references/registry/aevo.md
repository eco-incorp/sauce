<!-- Generated from the SDK's registries. Do not edit. -->

# Aevo (`aevo`)

High-performance options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Aevo` on ethereum |
| Chains | ethereum |
| Document | [aevo.md](../aevo.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Aevo` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's depositContract, `0x4082C9647c098a6493Fb499EaE63b5ce3259C574`.
  require(Aevo.DepositContract != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | depositContract | `0x4082C9647c098a6493Fb499EaE63b5ce3259C574` | `Aevo.DepositContract` |

## ABI

### `DepositContractABI`

`import DepositContractABI from "./protocols/aevo/DepositContractABI.json";` Speaks for: depositContract.

- `depositERC20(address l1Token, address l2Token, uint256 amount, uint32 minGasLimit, bytes extraData)`
- `depositETH(uint32 minGasLimit, bytes extraData) payable`
