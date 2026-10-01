<!-- Generated from the SDK's registries. Do not edit. -->

# GHO (`gho`)

Aave-native decentralized stablecoin minted against Aave V3 collateral. Multi-collateral, transparent, and governed by Aave DAO.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [gho.md](../gho.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's gho):

```sauce chain=ethereum
import GhoTokenABI from "./protocols/gho/GhoTokenABI.json";

const GHO = 0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2fn;

function main() {
  const bound = GhoTokenABI.at(GHO);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gho | `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f` | `GhoTokenABI.at(0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2fn)` |

## ABI

### `GhoTokenABI`

`import GhoTokenABI from "./protocols/gho/GhoTokenABI.json";` Speaks for: gho.

- `transfer(address to, uint256 amount) returns (bool)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
