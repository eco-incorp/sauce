<!-- Generated from the SDK's registries. Do not edit. -->

# Alchemix (`alchemix`)

Self-repaying loan protocol. Deposit yield-bearing collateral to borrow synthetic assets (alUSD, alETH) that repay themselves over time via yield.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Alchemix` on ethereum |
| Chains | ethereum |
| Document | [alchemix.md](../alchemix.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Alchemix` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's alETH, `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6`.
  require(Alchemix.AlETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | alETH | `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6` | `Alchemix.AlETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | alUSD | `0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9` | `Alchemix.AlUSD` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | alchemistAlETH | `0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5c` | `Alchemix.AlchemistAlETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | alchemistAlUSD | `0x5C6374a2ac4EBC38DeA0Fc1F8716e5Ea1AdD94dd` | `Alchemix.AlchemistAlUSD` |

## ABI

### `AlchemistABI`

`import AlchemistABI from "./protocols/alchemix/AlchemistABI.json";` Speaks for: alchemistAlUSD, alchemistAlETH.

- `deposit(address yieldToken, uint256 amount, address recipient) returns (uint256 shares)`
- `withdraw(address yieldToken, uint256 shares, address recipient) returns (uint256 amountWithdrawn)`
- `mint(uint256 amount, address recipient)`
- `burn(uint256 amount, address recipient) returns (uint256)`
- `liquidate(address yieldToken, uint256 shares, uint256 minimumAmountOut) returns (uint256)`
- `accounts(address owner) view returns (int256 debt, address[] depositedTokens)`
