<!-- Generated from the SDK's registries. Do not edit. -->

# Curve Finance (`curve`)

StableSwap AMM optimized for low-slippage swaps between pegged assets (stablecoins, wrapped tokens).

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Curve` on ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| Chains | ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| Document | [curve.md](../curve.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Curve` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's addressProvider, `0x0000000022D53366457F9d5E68Ec105046FC4383`.
  require(Curve.AddressProvider != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | crvToken | `0xD533a949740bb3306d119CC777fa900bA034cd52` | `Curve.CrvToken` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | routerNG | `0x16C6521Dff6baB339122a0FE25a9116693265353` | `Curve.RouterNG` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | threePool | `0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7` | `Curve.ThreePool` |
| [Optimism](../../../sauce-chains/references/optimism.md) | routerNG | `0x0DCDED3545D565bA3B19E683431381007245d983` | `Curve.RouterNG` |
| [Gnosis](../../../sauce-chains/references/gnosis.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Polygon](../../../sauce-chains/references/polygon.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Fantom](../../../sauce-chains/references/fantom.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Base](../../../sauce-chains/references/base.md) | routerNG | `0x4f37A9d177470499A2dD084621020b023fcffc1F` | `Curve.RouterNG` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | routerNG | `0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D` | `Curve.RouterNG` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |

## ABI

### `CurveAddressProviderABI`

`import CurveAddressProviderABI from "./protocols/curve/CurveAddressProviderABI.json";` Speaks for: addressProvider.

- `get_registry() view returns (address)`
- `get_address(uint256 _id) view returns (address)`

### `CurveRouterNGABI`

`import CurveRouterNGABI from "./protocols/curve/CurveRouterNGABI.json";` Speaks for: routerNG.

- `exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _expected, address[5] _pools) payable returns (uint256)`
- `exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy, address[5] _pools, address _receiver) payable returns (uint256)`
- `get_dy(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, address[5] _pools) view returns (uint256)`

### `CurveStableSwapABI`

`import CurveStableSwapABI from "./protocols/curve/CurveStableSwapABI.json";`

- `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)`
- `exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)`
- `add_liquidity(uint256[] amounts, uint256 min_mint_amount) returns (uint256)`
- `remove_liquidity(uint256 _amount, uint256[] min_amounts) returns (uint256[])`
- `remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount) returns (uint256)`
- `get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)`
- `get_virtual_price() view returns (uint256)`

### `CurveThreePoolABI`

`import CurveThreePoolABI from "./protocols/curve/CurveThreePoolABI.json";` Speaks for: threePool.

- `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)`
- `add_liquidity(uint256[3] amounts, uint256 min_mint_amount)`
- `remove_liquidity(uint256 _amount, uint256[3] min_amounts)`
- `remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount)`
- `get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)`
- `get_virtual_price() view returns (uint256)`
