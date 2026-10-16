<!-- Generated from the SDK's registries. Do not edit. -->

# crvUSD (`crvusd`)

> crvUSD is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against them.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Curve Finance native stablecoin using LLAMMA (Lending-Liquidating AMM Algorithm) for soft liquidations.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Crvusd` on ethereum |
| Chains | ethereum |

## Key Operations

- **transfer**: Transfer crvUSD tokens
- **approve**: Approve crvUSD token spender

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Transfer crvUSD
import { transfer } from "@sauce/token";
function main(crvusdAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(crvusdAddress, to, amount);
  return 1;
}

// Approve crvUSD spender
import { approve } from "@sauce/token";
function main(crvusdAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(crvusdAddress, spender, amount);
  return 1;
}
```

## Notes

- TVL: $500M+. LLAMMA provides soft liquidations - collateral gradually converted to crvUSD during price drops
- Soft liquidation = collateral is progressively swapped rather than instant liquidation
- Borrowing happens through Curve lending controllers (per-market contracts)
- Supported collateral includes ETH, wstETH, sfrxETH, tBTC, wBTC
- crvUSD has a peg keeper mechanism to maintain $1 peg via Curve pools

## Its names in a program

On Ethereum, `Crvusd` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's crvusd, `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E`.
  require(Crvusd.CrvUSD != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | crvusd | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` | `Crvusd.CrvUSD` |

## ABI

### `CrvUSDERC20ABI`

`import CrvUSDERC20ABI from "./protocols/crvusd/CrvUSDERC20ABI.json";` Speaks for: crvusd.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
