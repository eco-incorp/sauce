<!-- Generated from the SDK's registries. Do not edit. -->

# Instadapp (`instadapp`)

Flash loan aggregator that routes across Aave, Maker, Balancer and other sources to find the cheapest flash loan.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [instadapp.md](../instadapp.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's flashloanAggregator):

```sauce chain=ethereum
import FlashAggregatorABI from "./protocols/instadapp/FlashAggregatorABI.json";

const FLASHLOAN_AGGREGATOR = 0xE6054aE0Dba269560061D736e7510Ce64fCD517dn;

function main() {
  const bound = FlashAggregatorABI.at(FLASHLOAN_AGGREGATOR);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | flashloanAggregator | `0xE6054aE0Dba269560061D736e7510Ce64fCD517d` | `FlashAggregatorABI.at(0xE6054aE0Dba269560061D736e7510Ce64fCD517dn)` |

## ABI

### `FlashAggregatorABI`

`import FlashAggregatorABI from "./protocols/instadapp/FlashAggregatorABI.json";` Speaks for: flashloanAggregator.

- `flashLoan(address[] tokens, uint256[] amounts, uint256 route, bytes data, bytes extraData)`
- `getRoutes() pure returns (uint16[] routes)`
