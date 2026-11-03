<!-- Generated from the SDK's registries. Do not edit. -->

# crvUSD (`crvusd`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> crvUSD is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against them.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Curve Finance native stablecoin using LLAMMA (Lending-Liquidating AMM Algorithm) for soft liquidations.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Crvusd` on ethereum |
| Chains | ethereum |

## What it offers

- **transfer**: Transfer crvUSD tokens
- **approve**: Approve crvUSD token spender

## Notes

- TVL: $500M+. LLAMMA provides soft liquidations - collateral gradually converted to crvUSD during price drops
- Soft liquidation = collateral is progressively swapped rather than instant liquidation
- Borrowing happens through Curve lending controllers (per-market contracts)
- Supported collateral includes ETH, wstETH, sfrxETH, tBTC, wBTC
- crvUSD has a peg keeper mechanism to maintain $1 peg via Curve pools

## Its names in a program

On Ethereum, `Crvusd` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's crvusd, `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E`.
  require(Crvusd.CrvUSD != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | crvusd | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` | `Crvusd.CrvUSD` |

## ABI

### `CrvUSDERC20ABI`

`import CrvUSDERC20ABI from "./protocols/crvusd/CrvUSDERC20ABI.json";` Speaks for: crvusd. The import is the contract's full ABI across every deployment; call it through the `Crvusd` namespace to have a function a chain's deployment does not run refused.

- `allowance(address arg0, address arg1) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `burn(uint256 _value) returns (bool)`
- `burnFrom(address _from, uint256 _value) returns (bool)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address _spender, uint256 _sub_value) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `increaseAllowance(address _spender, uint256 _add_value) returns (bool)`
- `mint(address _to, uint256 _value) returns (bool)`
- `minter() view returns (address)`
- `name() view returns (string)`
- `nonces(address arg0) view returns (uint256)`
- `permit(address _owner, address _spender, uint256 _value, uint256 _deadline, uint8 _v, bytes32 _r, bytes32 _s) returns (bool)`
- `salt() view returns (bytes32)`
- `set_minter(address _minter)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address _from, address _to, uint256 _value) returns (bool)`
- `version() view returns (string)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
