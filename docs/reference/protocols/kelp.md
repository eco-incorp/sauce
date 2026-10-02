<!-- Generated from the SDK's registries. Do not edit. -->

# Kelp DAO (`kelp`)

Liquid restaking protocol built on EigenLayer. Deposit LSTs (stETH, ETHx, etc.) and receive rsETH, a non-rebasing liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Kelp` on ethereum |
| Chains | ethereum |

## Key Operations

- **depositAsset**: Deposit LST to receive rsETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Deposit LST for rsETH
import { LRTDepositPoolABI as ILRTDepositPool } from "./abis";
function main(
  depositPoolAddress: Address,
  asset: Address,
  depositAmount: Uint256,
  minRSETHAmountExpected: Uint256,
): Uint256 {
  const pool = ILRTDepositPool.at(depositPoolAddress);
  pool.depositAsset(asset, depositAmount, minRSETHAmountExpected, "");
  return 1;
}
```

## Notes

- TVL: $2B+. Accepts stETH, ETHx, and other LSTs
- Approve the LST to lrtDepositPool before depositing
- minRSETHAmountExpected provides slippage protection
- Use getRsETHAmountToMint() to preview output before depositing

## Its names in a program

On Ethereum, `Kelp` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's lrtDepositPool, `0x036676389e48133B63a802f8635AD39E752D375D`.
  require(Kelp.LRTDepositPool != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | lrtDepositPool | `0x036676389e48133B63a802f8635AD39E752D375D` | `Kelp.LRTDepositPool` |
| [Ethereum](../chains/ethereum.md) | rsETH | `0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7` | `Kelp.RsETH` |

## ABI

### `LRTDepositPoolABI`

`import LRTDepositPoolABI from "./protocols/kelp/LRTDepositPoolABI.json";` Speaks for: lrtDepositPool.

- `depositAsset(address asset, uint256 depositAmount, uint256 minRSETHAmountExpected, string referralId)`
- `getRsETHAmountToMint(address asset, uint256 amount) view returns (uint256 rsethAmountToMint)`

### `RsETHABI`

`import RsETHABI from "./protocols/kelp/RsETHABI.json";` Speaks for: rsETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
