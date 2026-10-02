<!-- Generated from the SDK's registries. Do not edit. -->

# Opyn (`opyn`)

DeFi options protocol known for Squeeth (squared ETH), a power perpetual that provides leveraged ETH exposure without liquidations.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Opyn` on ethereum |
| Chains | ethereum |
| Document | [opyn.md](../opyn.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Opyn` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's controller, `0x64187ae08781B09368e6253F9E94951243A493D5`.
  require(Opyn.Controller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | controller | `0x64187ae08781B09368e6253F9E94951243A493D5` | `Opyn.Controller` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | oSQTH | `0xf1B99e3E573A1a9C5E6B2Ce818b617F0E664E86B` | `Opyn.OSQTH` |

## ABI

### `ControllerABI`

`import ControllerABI from "./protocols/opyn/ControllerABI.json";` Speaks for: controller.

- `mintPowerPerpAmount(uint256 _vaultId, uint256 _powerPerpAmount, uint256 _uniTokenId) payable returns (uint256, uint256)`
- `burnPowerPerpAmount(uint256 _vaultId, uint256 _powerPerpAmount, uint256 _withdrawAmount) returns (uint256 wPowerPerpAmount)`
- `deposit(uint256 _vaultId) payable`
- `withdraw(uint256 _vaultId, uint256 _amount)`
