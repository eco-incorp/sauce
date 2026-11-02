<!-- Generated from the SDK's registries. Do not edit. -->

# Instadapp (`instadapp`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Instadapp is a building block that other protocols are built on. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Flash loan aggregator that routes across Aave, Maker, Balancer and other sources.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Instadapp` on ethereum |
| Chains | ethereum |

## What it offers

- **getRoutes**: Query available flash loan routes and their IDs
- **flashLoan**: Execute a flash loan through a route

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

- `aaveLending() view returns (address)`
- `aaveLendingAddr() view returns (address)`
- `addTokenToCToken(address[] _cTokens)`
- `balancerLending() view returns (address)`
- `balancerLendingAddr() view returns (address)`
- `calculateFeeBPS(uint256 _route) view returns (uint256 BPS_)`
- `cDaiToken() view returns (address)`
- `cEthToken() view returns (address)`
- `comptrollerAddr() view returns (address)`
- `daiBorrowAmount() view returns (uint256)`
- `daiToken() view returns (address)`
- `executeOperation(address[] _assets, uint256[] _amounts, uint256[] _premiums, address _initiator, bytes _data) returns (bool)`
- `flashLoan(address[] tokens, uint256[] amounts, uint256 route, bytes data, bytes extraData)`
- `getRoutes() pure returns (uint16[] routes)`
- `initialize(address[] _ctokens)`
- `InstaFeeBPS() view returns (uint256)`
- `instaList() view returns (address)`
- `makerLending() view returns (address)`
- `makerLendingAddr() view returns (address)`
- `onFlashLoan(address _initiator, address, uint256 _amount, uint256 _fee, bytes _data) returns (bytes32)`
- `receiveFlashLoan(address[], uint256[] _amounts, uint256[] _fees, bytes _data)`
- `tokenToCToken(address) view returns (address)`
- `transferFeeToTreasury(address[] _tokens)`
- `treasuryAddr() view returns (address)`
- `troller() view returns (address)`
- `wEth() view returns (address)`
- `wethBorrowAmountPercentage() view returns (uint256)`
- `wEthToken() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
