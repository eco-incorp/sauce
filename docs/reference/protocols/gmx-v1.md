<!-- Generated from the SDK's registries. Do not edit. -->

# GMX V1 (`gmx-v1`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> GMX V1 is a perpetuals exchange: bet on a price, with leverage and no expiry date. This page lists
> the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Decentralized perpetual exchange with multi-asset liquidity pool (GLP). Supports leverage trading up to 50x.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | `Gmx`: `gmx-v1`, `gmx-v2` |
| Namespace | `GmxV1` on arbitrum, avalanche |
| Chains | arbitrum, avalanche |

## What it offers

- **openPosition**: Open/increase leveraged position via PositionRouter
- **closePosition**: Close/decrease leveraged position
- **swap**: Swap tokens via GMX Router

## Notes

- TVL: $500M+. Execution fee of 200000000000000 wei (0.0002 ETH) required for position requests
- Must call router.approvePlugin(positionRouter) once before using position operations
- Path: for longs, path=[collateral]. For shorts, path=[stablecoin]. For swaps, path=[tokenIn, tokenOut]
- sizeDelta is position size in USD with 30 decimals
- acceptablePrice: 0 for market price

## Its names in a program

On Arbitrum One, `GmxV1` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's glp, `0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258`.
  require(GmxV1.Glp != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | glp | `0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258` | `GmxV1.Glp` |
| [Arbitrum One](../chains/arbitrum.md) | positionRouter | `0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868` | `GmxV1.PositionRouter` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064` | `GmxV1.Router` |
| [Arbitrum One](../chains/arbitrum.md) | vault | `0x489ee077994B6658eAfA855C308275EAd8097C4A` | `GmxV1.Vault` |
| [Avalanche C-Chain](../chains/avalanche.md) | router | `0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8` | `GmxV1.Router` |
| [Avalanche C-Chain](../chains/avalanche.md) | vault | `0x9ab2De34A33fB459b538c43f251eB825645e8595` | `GmxV1.Vault` |

## ABI

### `PositionRouterABI`

`import PositionRouterABI from "./protocols/gmx-v1/PositionRouterABI.json";` Speaks for: positionRouter.

- `createIncreasePosition(address[] _path, address _indexToken, uint256 _amountIn, uint256 _minOut, uint256 _sizeDelta, bool _isLong, uint256 _acceptablePrice, uint256 _executionFee, bytes32 _referralCode, address _callbackTarget) payable returns (bytes32 requestKey)`
- `createDecreasePosition(address[] _path, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _acceptablePrice, uint256 _minOut, uint256 _executionFee, bool _withdrawETH, address _callbackTarget) payable returns (bytes32 requestKey)`

### `RouterABI`

`import RouterABI from "./protocols/gmx-v1/RouterABI.json";` Speaks for: router.

- `approvePlugin(address _plugin)`
- `swap(address[] _path, uint256 _amountIn, uint256 _minOut, address _receiver)`

### `VaultABI`

`import VaultABI from "./protocols/gmx-v1/VaultABI.json";` Speaks for: vault.

- `swap(address _tokenIn, address _tokenOut, address _receiver) returns (uint256)`
- `increasePosition(address _account, address _collateralToken, address _indexToken, uint256 _sizeDelta, bool _isLong)`
- `decreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
