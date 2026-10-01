<!-- Generated from the SDK's registries. Do not edit. -->

# Compound V3 (`compound-v3`)

Single-asset lending protocol (Comet) with isolated markets per base asset. Each market has one borrowable asset and multiple collateral assets.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Compound`: `compound-v2`, `compound-v3` |
| Namespace | `CompoundV3` on ethereum, optimism, polygon, base, arbitrum, scroll |
| Chains | ethereum, optimism, polygon, base, arbitrum, scroll |
| Document | [compound-v3.md](../compound-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `CompoundV3` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cUSDCv3, `0xc3d688B66703497DAA19211EEdff47f25384cdc3`.
  require(CompoundV3.CUSDCv3 != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cUSDCv3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | `CompoundV3.CUSDCv3` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cUSDTv3 | `0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840` | `CompoundV3.CUSDTv3` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cWETHv3 | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` | `CompoundV3.CWETHv3` |
| [Optimism](../../../sauce-chains/references/optimism.md) | cUSDCv3 | `0x2e44e174f7D53F0212823acC11C01A11d58c5bCB` | `CompoundV3.CUSDCv3` |
| [Polygon](../../../sauce-chains/references/polygon.md) | cUSDCv3 | `0xF25212E676D1F7F89Cd72fFEe66158f541246445` | `CompoundV3.CUSDCv3` |
| [Base](../../../sauce-chains/references/base.md) | cUSDCv3 | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | `CompoundV3.CUSDCv3` |
| [Base](../../../sauce-chains/references/base.md) | cWETHv3 | `0x46e6b214b524310239732D51387075E0e70970bf` | `CompoundV3.CWETHv3` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | cUSDCv3 | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` | `CompoundV3.CUSDCv3` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | cUSDTv3 | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` | `CompoundV3.CUSDTv3` |
| [Scroll](../../../sauce-chains/references/scroll.md) | cUSDCv3 | `0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44` | `CompoundV3.CUSDCv3` |

## ABI

### `CometABI`

`import CometABI from "./protocols/compound-v3/CometABI.json";` Speaks for: cUSDCv3, cWETHv3, cUSDTv3.

- `supply(address asset, uint256 amount)`
- `supplyTo(address dst, address asset, uint256 amount)`
- `withdraw(address asset, uint256 amount)`
- `withdrawTo(address to, address asset, uint256 amount)`
- `balanceOf(address account) view returns (uint256)`
- `borrowBalanceOf(address account) view returns (uint256)`
