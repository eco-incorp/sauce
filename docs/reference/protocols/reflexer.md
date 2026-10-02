<!-- Generated from the SDK's registries. Do not edit. -->

# Reflexer (`reflexer`)

Non-pegged stablecoin protocol issuing RAI. Uses a PID controller to dampen RAI price volatility against ETH collateral.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Reflexer` on ethereum |
| Chains | ethereum |

## Key Operations

- **exitRai**: Exit RAI from the system (withdraw RAI tokens)
- **joinRai**: Join RAI into the system (deposit RAI tokens)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Exit RAI from system
import { CoinJoinABI as ICoinJoin } from "./abis";
function main(coinJoinAddress: Address, account: Address, amount: Uint256): Uint256 {
  const coinJoin = ICoinJoin.at(coinJoinAddress);
  coinJoin.exit(account, amount);
  return 1;
}

// Join RAI into system
import { CoinJoinABI as ICoinJoin } from "./abis";
function main(coinJoinAddress: Address, account: Address, amount: Uint256): Uint256 {
  const coinJoin = ICoinJoin.at(coinJoinAddress);
  coinJoin.join(account, amount);
  return 1;
}
```

## Notes

- RAI is non-pegged, floating around $3 - NOT a $1 stablecoin
- PID controller adjusts the redemption rate to dampen RAI price volatility
- Inspired by MakerDAO but with a non-pegged design philosophy
- SAFEs (similar to MakerDAO Vaults) hold ETH collateral backing RAI debt
- coinJoin converts between internal system debt units and external RAI ERC-20
- ethJoin converts between ETH and internal collateral accounting

## Its names in a program

On Ethereum, `Reflexer` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's coinJoin, `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45`.
  require(Reflexer.CoinJoin != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | coinJoin | `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45` | `Reflexer.CoinJoin` |
| [Ethereum](../chains/ethereum.md) | ethJoin | `0x2D3cD7b81c93f188F3CB8aD87c8Acc73d6226e3a` | `Reflexer.ETHJoin` |
| [Ethereum](../chains/ethereum.md) | rai | `0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919` | `Reflexer.Rai` |
| [Ethereum](../chains/ethereum.md) | safeEngine | `0xCC88a9d330da1133Df3A7bD823B95e52511A6962` | `Reflexer.SAFEEngine` |

## ABI

### `CoinJoinABI`

`import CoinJoinABI from "./protocols/reflexer/CoinJoinABI.json";` Speaks for: coinJoin.

- `join(address account, uint256 wad)`
- `exit(address account, uint256 wad)`

### `ETHJoinABI`

`import ETHJoinABI from "./protocols/reflexer/ETHJoinABI.json";` Speaks for: ethJoin.

- `join(address account, uint256 wad)`
- `exit(address account, uint256 wad)`

### `SAFEEngineABI`

`import SAFEEngineABI from "./protocols/reflexer/SAFEEngineABI.json";` Speaks for: safeEngine.

- `modifySAFECollateralization(bytes32 collateralType, address safe, address collateralSource, address debtDestination, int256 deltaCollateral, int256 deltaDebt)`
- `safes(bytes32 collateralType, address safe) view returns (uint256 lockedCollateral, uint256 generatedDebt)`
