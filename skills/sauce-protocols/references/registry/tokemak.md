<!-- Generated from the SDK's registries. Do not edit. -->

# Tokemak (`tokemak`)

Liquidity routing protocol with Autopilot Autopools that automatically deploy and rebalance liquidity across DeFi destinations.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Tokemak` on ethereum |
| Chains | ethereum |
| Document | [tokemak.md](../tokemak.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Tokemak` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's autopoolRegistry, `0x7E5828a3A6Ae75426d739E798140513A2E2964E4`.
  require(Tokemak.AutopoolRegistry != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | autopoolRegistry | `0x7E5828a3A6Ae75426d739E798140513A2E2964E4` | `Tokemak.AutopoolRegistry` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | systemRegistry | `0x2218F90A98b0C070676f249EF44834686dAa4285` | `Tokemak.SystemRegistry` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | toke | `0x2e9d63788249371f1DFC918a52f8d799F4a38C94` | `Tokemak.Toke` |

## ABI

### `AutopoolABI`

`import AutopoolABI from "./protocols/tokemak/AutopoolABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `totalAssets() view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
