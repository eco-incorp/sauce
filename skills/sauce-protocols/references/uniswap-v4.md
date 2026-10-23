# Uniswap V4

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Singleton AMM with hooks architecture enabling custom pool logic, flash accounting, and native ETH support. All pools share a single PoolManager contract for gas savings on multi-hop swaps.

## When to use it

- Every pool lives in one PoolManager, keyed by `(currency0, currency1, fee, tickSpacing,
hooks)`. A pool can attach a hook contract that runs around swaps and liquidity changes, and a
  currency of `0x0` is the native coin.
- A Sauce program swaps a pool with `@sauce/router`'s `uniswapV4`, with a price limit; no
  UniversalRouter commands are needed.

## Pitfalls for a program

- Exact input is a **negative** `amountSpecified`, the reverse of V3's pool. For raw calls use
  `-Int256(amount)` when `amount` is unsigned; `uniswapV4` takes a positive `amountIn` and handles
  the protocol's signed convention itself.
- A hook can change a pool's behaviour and fee: use hookless keys (`hooks: 0`) unless you have
  reviewed the hook.
- A protocol fee can apply on top of the LP fee; both are in the pool's state
  (`sauce-distributed-swap` reads them).
- Anyone can initialize a key: a pool can exist with no liquidity at a stale price. Read its
  liquidity before trusting its price.
- A native-coin pool (`currency0` of `0x0`) is a different pair from the WETH pools.

## In a Sauce program

One guarded swap on the hookless 0.05% WETH/USDC pool:

```sauce chain=base,arbitrum
import { uniswapV4 } from "@sauce/router";

function main(amountIn: Uint256, sqrtPriceLimitX96: Uint256, minOut: Uint256, recipient: Address) {
  const before = WETH.balanceOf(pot);
  uniswapV4(UniswapV4.PoolManager, WETH, USDC, amountIn, 500, 10, 0, sqrtPriceLimitX96, minOut, recipient);
  const unspent = amountIn - (before - WETH.balanceOf(pot));
  if (unspent > 0) {
    WETH.transfer(recipient, unspent);
  }
}
```

`uniswapV4` builds the key from the two tokens in sort order with the fee (`500`), tick spacing
(`10`) and hooks (`0`, none), pays `recipient` and reverts below `minOut`. The WETH the pool did
not take before the price limit goes back to `recipient` too.

## Category

dex | Chains and addresses: [registry/uniswap-v4.md](registry/uniswap-v4.md)

## Key Operations

- **swap**: Execute a swap through the UniversalRouter using command-based encoding
- **addLiquidity**: Modify liquidity positions through the PositionManager
- **removeLiquidity**: Decrease or remove liquidity positions through the PositionManager

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { UniswapV4UniversalRouterABI as IUniversalRouter } from "./abis";

function main(routerAddress: Address, commands: bytes, inputs: bytes[]): Uint256 {
  const router = IUniversalRouter.at(routerAddress);
  router.execute(commands, inputs, 99999999999);
  return 1;
}
```

- `routerAddress`: UniversalRouter address for the target chain
- `commands`: Encoded bytes of command IDs defining the sequence of operations (each byte = one command)
- `inputs`: Encoded bytes array of ABI-encoded parameters for each command
- Commands and inputs must be pre-encoded off-chain; the router decodes and executes sequentially

### addLiquidity

```typescript
import { UniswapV4PositionManagerABI as IPositionManager } from "./abis";

function main(positionManagerAddress: Address, unlockData: bytes): Uint256 {
  const pm = IPositionManager.at(positionManagerAddress);
  pm.modifyLiquidities(unlockData, 99999999999);
  return 1;
}
```

- `positionManagerAddress`: PositionManager address for the target chain
- `unlockData`: ABI-encoded liquidity modification data including pool key, tick range, and amounts
- Data must be pre-encoded off-chain with the position parameters

### removeLiquidity

```typescript
import { UniswapV4PositionManagerABI as IPositionManager } from "./abis";

function main(positionManagerAddress: Address, unlockData: bytes): Uint256 {
  const pm = IPositionManager.at(positionManagerAddress);
  pm.modifyLiquidities(unlockData, 99999999999);
  return 1;
}
```

- Same interface as addLiquidity but with negative liquidityDelta in the encoded data

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/uniswap-v4.md](registry/uniswap-v4.md).

### UniswapV4StateViewABI

StateView (v4-periphery `src/lens/StateView.sol`) reads the PoolManager's pool state as views. A `poolId` is a `bytes32`: keccak256 of the ABI-encoded pool key.

- `getSlot0(bytes32 poolId) -> (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)` - Current price, tick and fees
- `getLiquidity(bytes32 poolId) -> uint128 liquidity` - In-range liquidity
- `getTickInfo(bytes32 poolId, int24 tick) -> (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128)` - One tick's state
- `getTickLiquidity(bytes32 poolId, int24 tick) -> (uint128 liquidityGross, int128 liquidityNet)` - One tick's liquidity
- `getTickFeeGrowthOutside(bytes32 poolId, int24 tick) -> (uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128)` - One tick's fee growth outside
- `getTickBitmap(bytes32 poolId, int16 tick) -> uint256 tickBitmap` - One word of the initialized-tick bitmap
- `getFeeGrowthGlobals(bytes32 poolId) -> (uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1)` - Global fee growth
- `getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) -> (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)` - Fee growth inside a range
- `getPositionInfo(bytes32 poolId, bytes32 positionId) -> (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)` - A position by id
- `getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) -> (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)` - A position by its key
- `getPositionLiquidity(bytes32 poolId, bytes32 positionId) -> uint128 liquidity` - A position's liquidity
- `poolManager() -> address` - The PoolManager it reads

## Notes

- V4 uses a singleton architecture: ALL pools live in a single PoolManager contract, saving gas on multi-hop swaps
- Hooks: each pool can attach a custom hooks contract that intercepts before/after swap and liquidity events
- Pool key: `(currency0, currency1, fee, tickSpacing, hooks)` uniquely identifies a pool
- `currency0` = address(0) means native ETH; V4 supports native ETH directly (no WETH wrapping needed)
- `zeroForOne`: true = swap currency0 for currency1; false = swap currency1 for currency0
- `amountSpecified`: negative = exact input; positive = exact output (the reverse of Uniswap V3's pool `swap`)
- Flash accounting: V4 uses transient storage for balance tracking within a transaction, settling at the end
- Commands/inputs for the UniversalRouter must be constructed off-chain; this is more complex than V3 but more powerful
- V4 is the newest Uniswap version; use it for advanced pool logic (custom hooks) or when gas efficiency on multi-hop matters most
- From a Pot program, `@sauce/router`'s `uniswapV4(poolManager, tokenIn, tokenOut, amountIn, fee, tickSpacing, hooks, sqrtPriceLimitX96, minOut, recipient)` swaps one pool through the Pot's Sauce Router, with no UniversalRouter or approval. The pool key is `tokenIn` and `tokenOut` in sort order (native ETH, the zero address, first), with `fee`, `tickSpacing` and `hooks`. Pass positive `amountIn`; the helper handles the signed exact-input convention and returns output. The `uniswapV4Swap` action is the same call.
- On Arc (5042) the PositionManager's `WETH9()` is a stub that always reverts with `UnsupportedProtocolError()`. Arc's native coin is USDC at 18 decimals, so a pool keyed on `address(0)` is native USDC, a different currency from the 6-decimal ERC-20 `0x3600000000000000000000000000000000000000` over the same balance
