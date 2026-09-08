# GMX V1

Decentralized perpetual exchange with multi-asset liquidity pool (GLP). Supports leverage trading up to 50x with low swap fees and zero price impact trades.

## Category

perpetuals | Chains: Arbitrum, Avalanche

## Key Operations

- **openPosition**: Open/increase leveraged position via PositionRouter
- **closePosition**: Close/decrease leveraged position
- **swap**: Swap tokens via GMX Router

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/gmx-v1";
```

## SauceScript Examples

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

## Key Addresses

| Chain     | Contract       | Address                                      |
| --------- | -------------- | -------------------------------------------- |
| Arbitrum  | vault          | `0x489ee077994B6658eAfA855C308275EAd8097C4A` |
| Arbitrum  | router         | `0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064` |
| Arbitrum  | positionRouter | `0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868` |
| Arbitrum  | glp            | `0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258` |
| Avalanche | vault          | `0x9ab2De34A33fB459b538c43f251eB825645e8595` |
| Avalanche | router         | `0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8` |

## ABI Methods

### PositionRouterABI

- `createIncreasePosition(address[],address,uint256,uint256,uint256,bool,uint256,uint256,bytes32)` - Open/increase. Params: path, indexToken, amountIn, minOut, sizeDelta, isLong, acceptablePrice, executionFee, referralCode
- `createDecreasePosition(address[],address,uint256,uint256,bool,address,uint256,uint256,uint256,bool)` - Close/decrease. Params: path, indexToken, collateralDelta, sizeDelta, isLong, receiver, acceptablePrice, minOut, executionFee, withdrawETH

### RouterABI

- `approvePlugin(address)` - Approve PositionRouter as plugin (required once)
- `swap(address[],uint256,uint256,address)` - Swap tokens. Params: path, amountIn, minOut, receiver

### VaultABI

- `swap(address,address,address)` - Direct swap (internal)
- `increasePosition(address,address,address,uint256,bool)` - Direct increase (internal)
- `decreasePosition(address,address,address,uint256,uint256,bool,address)` - Direct decrease (internal)

## Notes

- TVL: $500M+. Execution fee of 200000000000000 wei (0.0002 ETH) required for position requests
- Must call router.approvePlugin(positionRouter) once before using position operations
- Path: for longs, path=[collateral]. For shorts, path=[stablecoin]. For swaps, path=[tokenIn, tokenOut]
- sizeDelta is position size in USD with 30 decimals
- acceptablePrice: 0 for market price
