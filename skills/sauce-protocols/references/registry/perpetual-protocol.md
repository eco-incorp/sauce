<!-- Generated from the SDK's registries. Do not edit. -->

# Perpetual Protocol (`perpetual-protocol`)

Decentralized perpetual futures exchange (Curie v2) on Optimism. Concentrated-liquidity virtual AMM with cross-margin trading.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | none: import its ABI |
| Chains | optimism |
| Document | [perpetual-protocol.md](../perpetual-protocol.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Optimism's clearingHouse):

```sauce chain=optimism
import ClearingHouseABI from "./protocols/perpetual-protocol/ClearingHouseABI.json";

const CLEARING_HOUSE = 0x82ac2CE43e33683c58BE4cDc40975E73aA50f459n;

function main() {
  const bound = ClearingHouseABI.at(CLEARING_HOUSE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../../../sauce-chains/references/optimism.md) | clearingHouse | `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459` | `ClearingHouseABI.at(0x82ac2CE43e33683c58BE4cDc40975E73aA50f459n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | vault | `0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60` | `VaultABI.at(0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60n)` |

## ABI

### `ClearingHouseABI`

`import ClearingHouseABI from "./protocols/perpetual-protocol/ClearingHouseABI.json";` Speaks for: clearingHouse.

- `openPosition((address baseToken, bool isBaseToQuote, bool isExactInput, uint256 amount, uint256 oppositeAmountBound, uint256 deadline, uint160 sqrtPriceLimitX96, bytes32 referralCode) params) returns (uint256 base, uint256 quote)`
- `closePosition((address baseToken, uint160 sqrtPriceLimitX96, uint256 oppositeAmountBound, uint256 deadline, bytes32 referralCode) params) returns (uint256 base, uint256 quote)`
- `getAccountValue(address trader) view returns (int256)`

### `VaultABI`

`import VaultABI from "./protocols/perpetual-protocol/VaultABI.json";` Speaks for: vault.

- `deposit(address token, uint256 amount)`
- `withdraw(address token, uint256 amount)`
- `getFreeCollateral(address trader) view returns (uint256)`
