<!-- Generated from the SDK's registries. Do not edit. -->

# crvUSD (`crvusd`)

Curve Finance native stablecoin using LLAMMA (Lending-Liquidating AMM Algorithm) for soft liquidations.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [crvusd.md](../crvusd.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's crvusd):

```sauce chain=ethereum
import CrvUSDERC20ABI from "./protocols/crvusd/CrvUSDERC20ABI.json";

const CRVUSD = 0xf939E0A03FB07F59A73314E73794Be0E57ac1b4En;

function main() {
  const bound = CrvUSDERC20ABI.at(CRVUSD);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | crvusd | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` | `CrvUSDERC20ABI.at(0xf939E0A03FB07F59A73314E73794Be0E57ac1b4En)` |

## ABI

### `CrvUSDERC20ABI`

`import CrvUSDERC20ABI from "./protocols/crvusd/CrvUSDERC20ABI.json";` Speaks for: crvusd.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
