<!-- Generated from the SDK's registries. Do not edit. -->

# Liquity V2 (`liquity-v2`)

Next generation of Liquity protocol with user-set interest rates, multi-collateral support, and the BOLD stablecoin.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | `Liquity`: `liquity-v1`, `liquity-v2` |
| Namespace | `LiquityV2` on ethereum |
| Chains | ethereum |

## Key Operations

- **transfer**: Transfer BOLD tokens
- **approve**: Approve BOLD token spender

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Transfer BOLD
import { transfer } from "@sauce/token";
function main(boldAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(boldAddress, to, amount);
  return 1;
}

// Approve BOLD spender
import { approve } from "@sauce/token";
function main(boldAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(boldAddress, spender, amount);
  return 1;
}
```

## Notes

- User-set interest rates - borrowers choose their own rate (higher rate = lower liquidation risk)
- Multi-collateral: ETH, wstETH, rETH, and other LSTs
- BOLD is fully redeemable 1:1 for collateral at any time
- Successor to Liquity V1 with improved capital efficiency

## Its names in a program

On Ethereum, `LiquityV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's bold, `0x6440f144b7e50D6a8439336510312d2F54beB01D`.
  require(LiquityV2.Bold != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | bold | `0x6440f144b7e50D6a8439336510312d2F54beB01D` | `LiquityV2.Bold` |

## ABI

### `BoldTokenABI`

`import BoldTokenABI from "./protocols/liquity-v2/BoldTokenABI.json";` Speaks for: bold.

- `transfer(address to, uint256 amount) returns (bool)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
