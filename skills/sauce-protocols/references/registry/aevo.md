<!-- Generated from the SDK's registries. Do not edit. -->

# Aevo (`aevo`)

High-performance options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [aevo.md](../aevo.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's depositContract):

```sauce chain=ethereum
import DepositContractABI from "./protocols/aevo/DepositContractABI.json";

const DEPOSIT_CONTRACT = 0x4082C9647c098a6493Fb499EaE63b5ce3259C574n;

function main() {
  const bound = DepositContractABI.at(DEPOSIT_CONTRACT);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | depositContract | `0x4082C9647c098a6493Fb499EaE63b5ce3259C574` | `DepositContractABI.at(0x4082C9647c098a6493Fb499EaE63b5ce3259C574n)` |

## ABI

### `DepositContractABI`

`import DepositContractABI from "./protocols/aevo/DepositContractABI.json";` Speaks for: depositContract.

- `depositERC20(address l1Token, address l2Token, uint256 amount, uint32 minGasLimit, bytes extraData)`
- `depositETH(uint32 minGasLimit, bytes extraData) payable`
