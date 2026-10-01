<!-- Generated from the SDK's registries. Do not edit. -->

# Maker (`maker`)

Decentralized credit protocol behind DAI and USDS stablecoins. Users deposit collateral into Vaults to mint/borrow DAI. Includes the DAI Savings Rate (DSR) via sDAI.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [maker.md](../maker.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's pot):

```sauce chain=ethereum
import PotABI from "./protocols/maker/PotABI.json";

const POT = 0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7n;

function main() {
  const bound = PotABI.at(POT);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | dai | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pot | `0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7` | `PotABI.at(0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | sDAI | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` | `SavingsDaiABI.at(0x83F20F44975D03b1b09e64809B757c47f942BEeAn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | usds | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | vat | `0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B` | no registry ABI |

## ABI

### `PotABI`

`import PotABI from "./protocols/maker/PotABI.json";` Speaks for: pot.

- `join(uint256 wad)`
- `exit(uint256 wad)`
- `chi() view returns (uint256)`
- `dsr() view returns (uint256)`

### `SavingsDaiABI`

`import SavingsDaiABI from "./protocols/maker/SavingsDaiABI.json";` Speaks for: sDAI.

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
