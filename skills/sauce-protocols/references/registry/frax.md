<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Finance (`frax`)

Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Frax` on ethereum |
| Chains | ethereum |
| Document | [frax.md](../frax.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Frax` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's frax, `0x853d955aCEf822Db058eb8505911ED77F175b99e`.
  require(Frax.Frax != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | frax | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | `Frax.Frax` |

## ABI

### `FraxERC20ABI`

`import FraxERC20ABI from "./protocols/frax/FraxERC20ABI.json";` Speaks for: frax.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
