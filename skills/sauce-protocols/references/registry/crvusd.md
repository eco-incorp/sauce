<!-- Generated from the SDK's registries. Do not edit. -->

# crvUSD (`crvusd`)

Curve Finance native stablecoin using LLAMMA (Lending-Liquidating AMM Algorithm) for soft liquidations.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Crvusd` on ethereum |
| Chains | ethereum |
| Document | [crvusd.md](../crvusd.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Crvusd` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's crvusd, `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E`.
  require(Crvusd.CrvUSD != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | crvusd | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` | `Crvusd.CrvUSD` |

## ABI

### `CrvUSDERC20ABI`

`import CrvUSDERC20ABI from "./protocols/crvusd/CrvUSDERC20ABI.json";` Speaks for: crvusd.

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
