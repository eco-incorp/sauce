<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Ether (`frax-ether`)

Frax Finance's liquid staking derivative. sfrxETH is the staking vault token that accrues ETH staking yield.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [frax-ether.md](../frax-ether.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's frxETHMinter):

```sauce chain=ethereum
import FrxETHMinterABI from "./protocols/frax-ether/FrxETHMinterABI.json";

const FRX_ETHMINTER = 0xbAFA44EFE7901E04E39Dad13167D089C559c1138n;

function main() {
  const bound = FrxETHMinterABI.at(FRX_ETHMINTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | frxETHMinter | `0xbAFA44EFE7901E04E39Dad13167D089C559c1138` | `FrxETHMinterABI.at(0xbAFA44EFE7901E04E39Dad13167D089C559c1138n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | sfrxETH | `0xac3E018457B222d93114458476f3E3416Abbe38F` | `SfrxETHABI.at(0xac3E018457B222d93114458476f3E3416Abbe38Fn)` |

## ABI

### `FrxETHMinterABI`

`import FrxETHMinterABI from "./protocols/frax-ether/FrxETHMinterABI.json";` Speaks for: frxETHMinter.

- `submitAndDeposit(address recipient) payable returns (uint256 shares)`

### `SfrxETHABI`

`import SfrxETHABI from "./protocols/frax-ether/SfrxETHABI.json";` Speaks for: sfrxETH.

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
