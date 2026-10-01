<!-- Generated from the SDK's registries. Do not edit. -->

# ZeroLend (`zerolend`)

Leading lending protocol on zkSync Era. Aave V3 fork optimized for zero-knowledge rollups with low transaction costs.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | zksync |
| Document | [zerolend.md](../zerolend.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here zkSync Era's pool):

```sauce chain=zksync
import ZeroLendPoolABI from "./protocols/zerolend/ZeroLendPoolABI.json";

const POOL = 0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8n;

function main() {
  const bound = ZeroLendPoolABI.at(POOL);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | pool | `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8` | `ZeroLendPoolABI.at(0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8n)` |

## ABI

### `ZeroLendPoolABI`

`import ZeroLendPoolABI from "./protocols/zerolend/ZeroLendPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
