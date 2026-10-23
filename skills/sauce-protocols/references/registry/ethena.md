<!-- Generated from the SDK's registries. Do not edit. -->

# Ethena (`ethena`)

Synthetic dollar protocol providing USDe, a crypto-native dollar backed by delta-neutral positions. sUSDe offers yield from staking and funding rates.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Ethena` on ethereum |
| Chains | ethereum |
| Document | [ethena.md](../ethena.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Ethena` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's susde, `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497`.
  require(Ethena.Susde != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | susde | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | `Ethena.Susde` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | usde | `0x4c9EDD5852cd905f086C759E8383e09bff1E68B3` | `Ethena.USDe` |

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
