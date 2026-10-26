<!-- Generated from the SDK's registries. Do not edit. -->

# Coinbase Wrapped Staked ETH (`cbeth`)

Coinbase's liquid staking token for Ethereum. cbETH represents staked ETH plus accrued staking rewards.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Cbeth` on ethereum, base |
| Chains | ethereum, base |
| Document | [cbeth.md](../cbeth.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Cbeth` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cbETH, `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704`.
  require(Cbeth.CbETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cbETH | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` | `Cbeth.CbETH` |
| [Base](../../../sauce-chains/references/base.md) | cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | `Cbeth.CbETH`; not on this deployment: `exchangeRate` |

## ABI

### `CbETHABI`

`import CbETHABI from "./protocols/cbeth/CbETHABI.json";` Speaks for: cbETH.

- `mint(address to, uint256 amount) returns (bool)`
- `exchangeRate() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`

Not on Base's cbETH (`0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22`), whose code does not dispatch them: `exchangeRate`. Do not call them there: the call does not run the function, and whether it reverts is up to that code.
