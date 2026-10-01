<!-- Generated from the SDK's registries. Do not edit. -->

# Seamless (`seamless`)

Native lending and borrowing protocol on Base. Aave V3 fork with integrated leverage strategies (ILMs) for one-click leveraged yield.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | base |
| Document | [seamless.md](../seamless.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Base's pool):

```sauce chain=base
import SeamlessPoolABI from "./protocols/seamless/SeamlessPoolABI.json";

const POOL = 0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7n;

function main() {
  const bound = SeamlessPoolABI.at(POOL);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | pool | `0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7` | `SeamlessPoolABI.at(0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7n)` |
| [Base](../../../sauce-chains/references/base.md) | poolAddressesProvider | `0x0E02EB705be564c2bF0067928A8f8DD89a82B26E` | no registry ABI |

## ABI

### `SeamlessPoolABI`

`import SeamlessPoolABI from "./protocols/seamless/SeamlessPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
