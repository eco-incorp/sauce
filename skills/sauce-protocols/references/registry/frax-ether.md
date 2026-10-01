<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Ether (`frax-ether`)

Frax Finance's liquid staking derivative. sfrxETH is the staking vault token that accrues ETH staking yield.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `FraxEther` on ethereum |
| Chains | ethereum |
| Document | [frax-ether.md](../frax-ether.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `FraxEther` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's frxETHMinter, `0xbAFA44EFE7901E04E39Dad13167D089C559c1138`.
  require(FraxEther.FrxETHMinter != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | frxETHMinter | `0xbAFA44EFE7901E04E39Dad13167D089C559c1138` | `FraxEther.FrxETHMinter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | sfrxETH | `0xac3E018457B222d93114458476f3E3416Abbe38F` | `FraxEther.SfrxETH` |

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
