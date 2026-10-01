<!-- Generated from the SDK's registries. Do not edit. -->

# Ethena (`ethena`)

Synthetic dollar protocol providing USDe, a crypto-native dollar backed by delta-neutral positions. sUSDe offers yield from staking and funding rates.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [ethena.md](../ethena.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's susde):

```sauce chain=ethereum
import StakedUSDeABI from "./protocols/ethena/StakedUSDeABI.json";

const SUSDE = 0x9D39A5DE30e57443BfF2A8307A4256c8797A3497n;

function main() {
  const bound = StakedUSDeABI.at(SUSDE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | susde | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | `StakedUSDeABI.at(0x9D39A5DE30e57443BfF2A8307A4256c8797A3497n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | usde | `0x4c9EDD5852cd905f086C759E8383e09bff1e68b3` | `USDeABI.at(0x4c9EDD5852cd905f086C759E8383e09bff1e68b3n)` |

## ABI

### `StakedUSDeABI`

`import StakedUSDeABI from "./protocols/ethena/StakedUSDeABI.json";` Speaks for: susde.

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `cooldownAssets(uint256 assets) returns (uint256 shares)`
- `cooldownShares(uint256 shares) returns (uint256 assets)`
- `unstake(address receiver)`

### `USDeABI`

`import USDeABI from "./protocols/ethena/USDeABI.json";` Speaks for: usde.

- `approve(address spender, uint256 amount) returns (bool)`
