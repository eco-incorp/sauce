<!-- Generated from the SDK's registries. Do not edit. -->

# GMX V1 (`gmx-v1`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Decentralized perpetual exchange with multi-asset liquidity pool (GLP). Supports leverage trading up to 50x with low swap fees and zero price impact trades.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | `Gmx`: `gmx-v1`, `gmx-v2` |
| Namespace | `GmxV1` on arbitrum, avalanche |
| Chains | arbitrum, avalanche |

## Key Operations

- **openPosition**: Open/increase leveraged position via PositionRouter
- **closePosition**: Close/decrease leveraged position
- **swap**: Swap tokens via GMX Router

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Open leveraged long position
import { PositionRouterABI as IPositionRouter } from "./abis";
function main(
  positionRouterAddress: Address,
  path: Address[],
  indexToken: Address,
  amountIn: Uint256,
  sizeDelta: Uint256,
  isLong: bool,
): Uint256 {
  const positionRouter = IPositionRouter.at(positionRouterAddress);
  positionRouter.createIncreasePosition(
    path,
    indexToken,
    amountIn,
    0,
    sizeDelta,
    isLong,
    0,
    200000000000000,
    0x0000000000000000000000000000000000000000000000000000000000000000,
    0x0000000000000000000000000000000000000000,
  );
  return 1;
}

// Close position
import { PositionRouterABI as IPositionRouter } from "./abis";
function main(
  positionRouterAddress: Address,
  path: Address[],
  indexToken: Address,
  collateralDelta: Uint256,
  sizeDelta: Uint256,
  isLong: bool,
  receiver: Address,
): Uint256 {
  const positionRouter = IPositionRouter.at(positionRouterAddress);
  positionRouter.createDecreasePosition(
    path,
    indexToken,
    collateralDelta,
    sizeDelta,
    isLong,
    receiver,
    0,
    0,
    200000000000000,
    false,
    0x0000000000000000000000000000000000000000,
  );
  return 1;
}

// Swap tokens
import { RouterABI as IRouter } from "./abis";
function main(
  routerAddress: Address,
  path: Address[],
  amountIn: Uint256,
  minOut: Uint256,
  receiver: Address,
): Uint256 {
  const router = IRouter.at(routerAddress);
  router.swap(path, amountIn, minOut, receiver);
  return 1;
}
```

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
