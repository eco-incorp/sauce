<!-- Generated from the SDK's registries. Do not edit. -->

# Instadapp (`instadapp`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Instadapp is a building block that other protocols are built on. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Flash loan aggregator that routes across Aave, Maker, Balancer and other sources to find the cheapest flash loan.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Instadapp` on ethereum |
| Chains | ethereum |

## What it offers

- **getRoutes**: Query available flash loan routes and their IDs
- **flashLoan**: Execute a flash loan via optimal route

## Notes

- Aggregates flash loans from: Aave V2/V3, Maker, Balancer, Compound, and others
- Each route has a different fee structure - use getRoutes to find available options
- route parameter selects which underlying protocol to borrow from
- Callback pattern: your contract must implement the receiver interface to repay
- Flash loans must be repaid within the same transaction (atomic)

## Its names in a program

On Ethereum, `Instadapp` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's flashloanAggregator, `0xE6054aE0Dba269560061D736e7510Ce64fCD517d`.
  require(Instadapp.FlashloanAggregator != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | flashloanAggregator | `0xE6054aE0Dba269560061D736e7510Ce64fCD517d` | `Instadapp.FlashloanAggregator` |

## ABI

### `FlashAggregatorABI`

`import FlashAggregatorABI from "./protocols/instadapp/FlashAggregatorABI.json";` Speaks for: flashloanAggregator.

- `flashLoan(address[] tokens, uint256[] amounts, uint256 route, bytes data, bytes extraData)`
- `getRoutes() pure returns (uint16[] routes)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
