<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Finance (`frax`)

Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [frax.md](../frax.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's frax):

```sauce chain=ethereum
import FraxERC20ABI from "./protocols/frax/FraxERC20ABI.json";

const FRAX = 0x853d955aCEf822Db058eb8505911ED77F175b99en;

function main() {
  const bound = FraxERC20ABI.at(FRAX);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | frax | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | `FraxERC20ABI.at(0x853d955aCEf822Db058eb8505911ED77F175b99en)` |

## ABI

### `FraxERC20ABI`

`import FraxERC20ABI from "./protocols/frax/FraxERC20ABI.json";` Speaks for: frax.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
