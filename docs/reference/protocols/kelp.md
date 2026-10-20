<!-- Generated from the SDK's registries. Do not edit. -->

# Kelp DAO (`kelp`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Kelp DAO is a restaking protocol: staked coins put to work securing other services too. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Liquid restaking protocol built on EigenLayer. Deposit LSTs (stETH, ETHx, etc.) and receive rsETH, a non-rebasing liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Kelp` on ethereum |
| Chains | ethereum |

## What it offers

- **depositAsset**: Deposit LST to receive rsETH

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
  require(Kelp.LRTDepositPool != 0);
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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
