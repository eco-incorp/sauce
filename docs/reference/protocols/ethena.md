<!-- Generated from the SDK's registries. Do not edit. -->

# Ethena (`ethena`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Ethena is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against them.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Synthetic dollar protocol providing USDe, a crypto-native dollar backed by delta-neutral positions. sUSDe offers yield from staking and funding rates.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Ethena` on ethereum |
| Chains | ethereum |

## What it offers

- **stakeUSDe**: Stake USDe to receive sUSDe (yield-bearing)
- **cooldownAssets**: Start cooldown period to unstake (by asset amount)
- **cooldownShares**: Start cooldown period to unstake (by share amount)
- **unstake**: Complete unstake after cooldown period

## Notes

- TVL: $3B+. Yield comes from ETH staking rewards + perpetual funding rates
- 7-day cooldown period required before unstaking
- Flow: deposit (stake) -> cooldownAssets/cooldownShares (start cooldown) -> unstake (after 7 days)
- Approve USDe to sUSDe contract before depositing
- sUSDe appreciates against USDe as yield accrues

## Its names in a program

On Ethereum, `Ethena` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's susde, `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497`.
  require(Ethena.Susde != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | susde | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | `Ethena.Susde` |
| [Ethereum](../chains/ethereum.md) | usde | `0x4c9EDD5852cd905f086C759E8383e09bff1E68B3` | `Ethena.USDe` |

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
