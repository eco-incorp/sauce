<!-- Generated from the SDK's registries. Do not edit. -->

# Radiant (`radiant`)

Omnichain lending protocol on Arbitrum. Aave V2 fork with cross-chain lending capabilities via LayerZero. Requires dLP locking for emission eligibility.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arbitrum |
| Document | [radiant.md](../radiant.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arbitrum One's lendingPool):

```sauce chain=arbitrum
import RadiantLendingPoolABI from "./protocols/radiant/RadiantLendingPoolABI.json";

const LENDING_POOL = 0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1n;

function main() {
  const bound = RadiantLendingPoolABI.at(LENDING_POOL);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lendingPool | `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1` | `RadiantLendingPoolABI.at(0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1n)` |

## ABI

### `RadiantLendingPoolABI`

`import RadiantLendingPoolABI from "./protocols/radiant/RadiantLendingPoolABI.json";` Speaks for: lendingPool.

- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)`
