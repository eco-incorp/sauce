<!-- Generated from the SDK's registries. Do not edit. -->

# Seamless (`seamless`)

Native lending and borrowing protocol on Base. Aave V3 fork with integrated leverage strategies (ILMs) for one-click leveraged yield.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Seamless` on base |
| Chains | base |
| Document | [seamless.md](../seamless.md): what it is for, how to choose it, its pitfalls |

## In a program

On Base, `Seamless` is a namespace: its contracts need no import.

```sauce chain=base
function main() {
  // Base's pool, `0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7`.
  require(Seamless.Pool != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | pool | `0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7` | `Seamless.Pool` |
| [Base](../../../sauce-chains/references/base.md) | poolAddressesProvider | `0x0E02EB705be564c2bF0067928A8f8DD89a82B26E` | `Seamless.PoolAddressesProvider` |

## ABI

### `SeamlessPoolABI`

`import SeamlessPoolABI from "./protocols/seamless/SeamlessPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
