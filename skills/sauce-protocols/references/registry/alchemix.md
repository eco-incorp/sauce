<!-- Generated from the SDK's registries. Do not edit. -->

# Alchemix (`alchemix`)

Self-repaying loan protocol. Deposit yield-bearing collateral to borrow synthetic assets (alUSD, alETH) that repay themselves over time via yield.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [alchemix.md](../alchemix.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's alchemistAlETH):

```sauce chain=ethereum
import AlchemistABI from "./protocols/alchemix/AlchemistABI.json";

const ALCHEMIST_AL_ETH = 0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5cn;

function main() {
  const bound = AlchemistABI.at(ALCHEMIST_AL_ETH);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | alETH | `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | alUSD | `0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | alchemistAlETH | `0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5c` | `AlchemistABI.at(0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5cn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | alchemistAlUSD | `0x5C6374a2ac4EBC38DeA0Fc1F8716e5Ea1ADD94dd` | `AlchemistABI.at(0x5C6374a2ac4EBC38DeA0Fc1F8716e5Ea1ADD94ddn)` |

## ABI

### `AlchemistABI`

`import AlchemistABI from "./protocols/alchemix/AlchemistABI.json";` Speaks for: alchemistAlUSD, alchemistAlETH.

- `deposit(address yieldToken, uint256 amount, address recipient) returns (uint256 shares)`
- `withdraw(address yieldToken, uint256 shares, address recipient) returns (uint256 amountWithdrawn)`
- `mint(uint256 amount, address recipient)`
- `burn(uint256 amount, address recipient) returns (uint256)`
- `liquidate(address yieldToken, uint256 shares, uint256 minimumAmountOut) returns (uint256)`
- `accounts(address owner) view returns (int256 debt, address[] depositedTokens)`
