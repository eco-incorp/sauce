<!-- Generated from the SDK's registries. Do not edit. -->

# LayerBank (`layerbank`)

Leading lending protocol on Scroll. Compound V2 fork optimized for L2 rollups with low gas costs.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Layerbank` on scroll |
| Chains | scroll |
| Document | [layerbank.md](../layerbank.md): what it is for, how to choose it, its pitfalls |

## In a program

On Scroll, `Layerbank` is a namespace: its contracts need no import.

```sauce chain=scroll
function main() {
  // Scroll's core, `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa`.
  require(Layerbank.Core != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Scroll](../../../sauce-chains/references/scroll.md) | core | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` | `Layerbank.Core` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `LTokenABI`

`import LTokenABI from "./protocols/layerbank/LTokenABI.json";`

- `balanceOf(address account) view returns (uint256)`
- `underlyingBalanceOf(address account) view returns (uint256)`
- `borrowBalanceOf(address account) view returns (uint256)`
- `exchangeRate() view returns (uint256)`
- `underlying() view returns (address)`: the address is a token

### `LayerBankCoreABI`

`import LayerBankCoreABI from "./protocols/layerbank/LayerBankCoreABI.json";` Speaks for: core.

- `enterMarkets(address[] lTokens)`
- `exitMarket(address lToken)`
- `supply(address lToken, uint256 uAmount) payable returns (uint256)`
- `redeemToken(address lToken, uint256 lAmount) returns (uint256)`
- `redeemUnderlying(address lToken, uint256 uAmount) returns (uint256)`
- `borrow(address lToken, uint256 amount)`
- `repayBorrow(address lToken, uint256 amount) payable`
