<!-- Generated from the SDK's registries. Do not edit. -->

# Perpetual Protocol (`perpetual-protocol`)

Decentralized perpetual futures exchange (Curie v2) on Optimism. Concentrated-liquidity virtual AMM with cross-margin trading.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `PerpetualProtocol` on optimism |
| Chains | optimism |

## Key Operations

- **deposit**: Deposit collateral into Vault for trading
- **withdraw**: Withdraw collateral from Vault
- **openPosition**: Open a leveraged perpetual position
- **closePosition**: Close an existing perpetual position

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Deposit collateral
import { VaultABI as IVault } from "./abis";
function main(vaultAddress: Address, token: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.deposit(token, amount);
  return 1;
}

// Withdraw collateral
import { VaultABI as IVault } from "./abis";
function main(vaultAddress: Address, token: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.withdraw(token, amount);
  return 1;
}
```

## Notes

- Virtual AMM (vAMM) based pricing - no actual liquidity pools
- Cross-margin trading - all positions share the same collateral
- isBaseToQuote: true = short (sell base for quote), false = long (buy base with quote)
- Deposit collateral to Vault first, then trade via ClearingHouse
- sqrtPriceLimitX96 = 0 means no price limit (market order)

## Its names in a program

On Optimism, `PerpetualProtocol` is a namespace: its contracts need no import.

```ts
function main() {
  // Optimism's clearingHouse, `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459`.
  require(PerpetualProtocol.ClearingHouse != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../chains/optimism.md) | clearingHouse | `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459` | `PerpetualProtocol.ClearingHouse` |
| [Optimism](../chains/optimism.md) | vault | `0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60` | `PerpetualProtocol.Vault` |

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
