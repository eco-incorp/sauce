<!-- Generated from the SDK's registries. Do not edit. -->

# LayerBank (`layerbank`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> LayerBank is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Lending protocol on Scroll. Compound-style markets (lTokens), but every user action goes through the Core contract, which names the market.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Layerbank` on scroll |
| Chains | scroll |

## Notes

- Unlike Compound V2, the lToken's own supply/borrow/redeem functions are callable only by Core
- Must call `enterMarkets` on Core before borrowing against any market
- Scroll-only deployment. TVL: $200M+. Audited

## Its names in a program

On Scroll, `Layerbank` is a namespace: its contracts need no import.

```ts
function main() {
  // Scroll's core, `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa`.
  require(Layerbank.Core != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Scroll](../chains/scroll.md) | core | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` | `Layerbank.Core` |

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
