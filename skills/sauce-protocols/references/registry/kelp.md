<!-- Generated from the SDK's registries. Do not edit. -->

# Kelp DAO (`kelp`)

Liquid restaking protocol built on EigenLayer. Deposit LSTs and receive rsETH, a liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [kelp.md](../kelp.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's lrtDepositPool):

```sauce chain=ethereum
import LRTDepositPoolABI from "./protocols/kelp/LRTDepositPoolABI.json";

const LRT_DEPOSIT_POOL = 0x036676389e48133B63a802f8635AD39E752D375Dn;

function main() {
  const bound = LRTDepositPoolABI.at(LRT_DEPOSIT_POOL);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lrtDepositPool | `0x036676389e48133B63a802f8635AD39E752D375D` | `LRTDepositPoolABI.at(0x036676389e48133B63a802f8635AD39E752D375Dn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rsETH | `0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7` | `RsETHABI.at(0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7n)` |

## ABI

### `LRTDepositPoolABI`

`import LRTDepositPoolABI from "./protocols/kelp/LRTDepositPoolABI.json";` Speaks for: lrtDepositPool.

- `depositAsset(address asset, uint256 depositAmount, uint256 minRSETHAmountExpected, string referralId)`
- `getRsETHAmountToMint(address asset, uint256 amount) view returns (uint256 rsethAmountToMint)`

### `RsETHABI`

`import RsETHABI from "./protocols/kelp/RsETHABI.json";` Speaks for: rsETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
