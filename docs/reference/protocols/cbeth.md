<!-- Generated from the SDK's registries. Do not edit. -->

# Coinbase Wrapped Staked ETH (`cbeth`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Coinbase Wrapped Staked ETH is a liquid staking protocol: stake a chain's coin and get back a
> token you can still use. This page lists the chains it is deployed on, the name a program writes
> for each of its contracts, and the functions a program can call.

Coinbase's liquid staking token for Ethereum. cbETH represents staked ETH plus accrued staking rewards. Non-rebasing.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Cbeth` on ethereum, base |
| Chains | ethereum, base |

## Key Operations

- **transfer**: Transfer cbETH tokens
- **approve**: Approve spender for cbETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Transfer cbETH
import { transfer } from "@sauce/token";
function main(cbethAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(cbethAddress, to, amount);
  return 1;
}

// Approve cbETH
import { approve } from "@sauce/token";
function main(cbethAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(cbethAddress, spender, amount);
  return 1;
}
```

## Notes

- TVL: $2.5B+. Non-rebasing - exchange rate increases over time
- Minted by Coinbase (mint is permissioned). On-chain operations are transfer/approve
- Compatible with EigenLayer restaking (cbETH strategy available)
- Available natively on Base L2

## Its names in a program

On Ethereum, `Cbeth` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cbETH, `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704`.
  require(Cbeth.CbETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cbETH | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` | `Cbeth.CbETH` |
| [Base](../chains/base.md) | cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | `Cbeth.CbETH` |

## ABI

### `CbETHABI`

`import CbETHABI from "./protocols/cbeth/CbETHABI.json";` Speaks for: cbETH.

- `mint(address to, uint256 amount) returns (bool)`
- `exchangeRate() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
