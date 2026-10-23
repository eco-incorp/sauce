<!-- Generated from the SDK's registries. Do not edit. -->

# Instadapp (`instadapp`)

Flash loan aggregator that routes across Aave, Maker, Balancer and other sources for a flash loan.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Instadapp` on ethereum |
| Chains | ethereum |
| Document | [instadapp.md](../instadapp.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Instadapp` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's flashloanAggregator, `0xE6054aE0Dba269560061D736e7510Ce64fCD517d`.
  require(Instadapp.FlashloanAggregator != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | flashloanAggregator | `0xE6054aE0Dba269560061D736e7510Ce64fCD517d` | `Instadapp.FlashloanAggregator` |

## ABI

### `FlashAggregatorABI`

`import FlashAggregatorABI from "./protocols/instadapp/FlashAggregatorABI.json";` Speaks for: flashloanAggregator.

- `flashLoan(address[] tokens, uint256[] amounts, uint256 route, bytes data, bytes extraData)`
- `getRoutes() pure returns (uint16[] routes)`
