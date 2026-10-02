<!-- Generated from the SDK's registries. Do not edit. -->

# GHO (`gho`)

Aave-native decentralized stablecoin minted against Aave V3 collateral. Multi-collateral, transparent, and governed by Aave DAO.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Gho` on ethereum |
| Chains | ethereum |
| Document | [gho.md](../gho.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Gho` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's gho, `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f`.
  require(Gho.Gho != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gho | `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f` | `Gho.Gho` |

## ABI

### `GhoTokenABI`

`import GhoTokenABI from "./protocols/gho/GhoTokenABI.json";` Speaks for: gho.

- `transfer(address to, uint256 amount) returns (bool)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
