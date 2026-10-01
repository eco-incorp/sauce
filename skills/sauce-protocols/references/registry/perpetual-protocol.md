<!-- Generated from the SDK's registries. Do not edit. -->

# Perpetual Protocol (`perpetual-protocol`)

Decentralized perpetual futures exchange (Curie v2) on Optimism. Concentrated-liquidity virtual AMM with cross-margin trading.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `PerpetualProtocol` on optimism |
| Chains | optimism |
| Document | [perpetual-protocol.md](../perpetual-protocol.md): what it is for, how to choose it, its pitfalls |

## In a program

On Optimism, `PerpetualProtocol` is a namespace: its contracts need no import.

```sauce chain=optimism
function main() {
  // Optimism's clearingHouse, `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459`.
  require(PerpetualProtocol.ClearingHouse != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../../../sauce-chains/references/optimism.md) | clearingHouse | `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459` | `PerpetualProtocol.ClearingHouse` |
| [Optimism](../../../sauce-chains/references/optimism.md) | vault | `0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60` | `PerpetualProtocol.Vault` |

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
