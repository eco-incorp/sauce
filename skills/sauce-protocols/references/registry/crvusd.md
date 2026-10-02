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

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
