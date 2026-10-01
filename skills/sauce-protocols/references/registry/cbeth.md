<!-- Generated from the SDK's registries. Do not edit. -->

# Coinbase Wrapped Staked ETH (`cbeth`)

Coinbase's liquid staking token for Ethereum. cbETH represents staked ETH plus accrued staking rewards.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, base |
| Document | [cbeth.md](../cbeth.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's cbETH):

```sauce chain=ethereum
import CbETHABI from "./protocols/cbeth/CbETHABI.json";

const CB_ETH = 0xBe9895146f7AF43049ca1c1AE358B0541Ea49704n;

function main() {
  const bound = CbETHABI.at(CB_ETH);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cbETH | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` | `CbETHABI.at(0xBe9895146f7AF43049ca1c1AE358B0541Ea49704n)` |
| [Base](../../../sauce-chains/references/base.md) | cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | `CbETHABI.at(0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22n)` |

## ABI

### `CbETHABI`

`import CbETHABI from "./protocols/cbeth/CbETHABI.json";` Speaks for: cbETH.

- `mint(address to, uint256 amount) returns (bool)`
- `exchangeRate() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
