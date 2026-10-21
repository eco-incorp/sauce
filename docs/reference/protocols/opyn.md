<!-- Generated from the SDK's registries. Do not edit. -->

# Opyn (`opyn`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Opyn is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

DeFi options protocol known for Squeeth (squared ETH), a power perpetual that provides leveraged ETH exposure without liquidations.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Opyn` on ethereum |
| Chains | ethereum |

## What it offers

- **burnSqueeth**: Burn oSQTH to close/reduce a squeeth position
- **withdrawCollateral**: Withdraw ETH collateral from a vault
- **mintSqueeth**: Mint oSQTH (open squeeth position) by depositing ETH collateral
- **deposit**: Deposit additional ETH collateral to an existing vault

## Notes

- Squeeth = squared ETH exposure (ETH^2), providing leveraged upside without liquidations
- Funding rate applies instead of liquidations - long positions pay short positions
- oSQTH is the ERC-20 power perpetual token
- Vaults hold ETH collateral backing minted oSQTH
- vaultId=0 in mintPowerPerpAmount creates a new vault
- Can use Uniswap V3 LP NFTs as collateral via uniTokenId parameter

## Its names in a program

On Ethereum, `Opyn` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's controller, `0x64187ae08781B09368e6253F9E94951243A493D5`.
  require(Opyn.Controller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | controller | `0x64187ae08781B09368e6253F9E94951243A493D5` | `Opyn.Controller` |
| [Ethereum](../chains/ethereum.md) | oSQTH | `0xf1B99e3E573A1a9C5E6B2Ce818b617F0E664E86B` | `Opyn.OSQTH` |

## ABI

### `ControllerABI`

`import ControllerABI from "./protocols/opyn/ControllerABI.json";` Speaks for: controller.

- `mintPowerPerpAmount(uint256 _vaultId, uint256 _powerPerpAmount, uint256 _uniTokenId) payable returns (uint256, uint256)`
- `burnPowerPerpAmount(uint256 _vaultId, uint256 _powerPerpAmount, uint256 _withdrawAmount) returns (uint256 wPowerPerpAmount)`
- `deposit(uint256 _vaultId) payable`
- `withdraw(uint256 _vaultId, uint256 _amount)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
