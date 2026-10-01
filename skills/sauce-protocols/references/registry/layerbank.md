<!-- Generated from the SDK's registries. Do not edit. -->

# LayerBank (`layerbank`)

Leading lending protocol on Scroll. Compound V2 fork optimized for L2 rollups with low gas costs.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | scroll |
| Document | [layerbank.md](../layerbank.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Scroll's core):

```sauce chain=scroll
import LayerBankCoreABI from "./protocols/layerbank/LayerBankCoreABI.json";

const CORE = 0xEC53c830f4444a8A56455c6836b5D2aA794289Aan;

function main() {
  const bound = LayerBankCoreABI.at(CORE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Scroll](../../../sauce-chains/references/scroll.md) | core | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` | `LayerBankCoreABI.at(0xEC53c830f4444a8A56455c6836b5D2aA794289Aan)` |

## ABI

### `LTokenABI`

`import LTokenABI from "./protocols/layerbank/LTokenABI.json";`

- `balanceOf(address account) view returns (uint256)`
- `underlyingBalanceOf(address account) view returns (uint256)`
- `borrowBalanceOf(address account) view returns (uint256)`
- `exchangeRate() view returns (uint256)`
- `underlying() view returns (address)`

### `LayerBankCoreABI`

`import LayerBankCoreABI from "./protocols/layerbank/LayerBankCoreABI.json";` Speaks for: core.

- `enterMarkets(address[] lTokens)`
- `exitMarket(address lToken)`
- `supply(address lToken, uint256 uAmount) payable returns (uint256)`
- `redeemToken(address lToken, uint256 lAmount) returns (uint256)`
- `redeemUnderlying(address lToken, uint256 uAmount) returns (uint256)`
- `borrow(address lToken, uint256 amount)`
- `repayBorrow(address lToken, uint256 amount) payable`
