<!-- Generated from the SDK's registries. Do not edit. -->

# Kelp DAO (`kelp`)

Liquid restaking protocol built on EigenLayer. Deposit LSTs and receive rsETH, a liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Kelp` on ethereum |
| Chains | ethereum |
| Document | [kelp.md](../kelp.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Kelp` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's lrtDepositPool, `0x036676389e48133B63a802f8635AD39E752D375D`.
  require(Kelp.LRTDepositPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lrtDepositPool | `0x036676389e48133B63a802f8635AD39E752D375D` | `Kelp.LRTDepositPool` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rsETH | `0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7` | `Kelp.RsETH` |

## ABI

### `LRTDepositPoolABI`

`import LRTDepositPoolABI from "./protocols/kelp/LRTDepositPoolABI.json";` Speaks for: lrtDepositPool.

- `depositAsset(address asset, uint256 depositAmount, uint256 minRSETHAmountExpected, string referralId)`
- `getRsETHAmountToMint(address asset, uint256 amount) view returns (uint256 rsethAmountToMint)`

### `RsETHABI`

`import RsETHABI from "./protocols/kelp/RsETHABI.json";` Speaks for: rsETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
