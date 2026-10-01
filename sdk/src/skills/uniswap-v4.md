# Uniswap V4

Singleton AMM with hooks architecture enabling custom pool logic, flash accounting, and native ETH support. All pools share a single PoolManager contract for gas savings on multi-hop swaps.

## Category

dex | Chains: Ethereum, Arbitrum, Optimism, Base, Polygon, BSC, Avalanche, Blast, Arc

## Key Operations

- **swap**: Execute a swap through the UniversalRouter using command-based encoding
- **addLiquidity**: Modify liquidity positions through the PositionManager
- **removeLiquidity**: Decrease or remove liquidity positions through the PositionManager

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/uniswap-v4";
```

## SauceScript Examples

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

## Key Addresses

| Chain     | Contract        | Address                                      |
| --------- | --------------- | -------------------------------------------- |
| Ethereum  | PoolManager     | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| Ethereum  | UniversalRouter | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` |
| Ethereum  | PositionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` |
| Arbitrum  | PoolManager     | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` |
| Arbitrum  | UniversalRouter | `0xa51afafe0263b40edaef0df8781ea9aa03e381a3` |
| Arbitrum  | PositionManager | `0xd88f38f930b7952f2db2432cb002e7abbf3dd869` |
| Optimism  | PoolManager     | `0x9a13f98cb987694c9f086b1f5eb990eea8264ec3` |
| Optimism  | UniversalRouter | `0x851116d9223fabed8e56c0e6b8ad0c31d98b3507` |
| Optimism  | PositionManager | `0x3c3ea4b57a46241e54610e5f022e5c45859a1017` |
| Base      | PoolManager     | `0x498581ff718922c3f8e6a244956af099b2652b2b` |
| Base      | UniversalRouter | `0x6ff5693b99212da76ad316178a184ab56d299b43` |
| Base      | PositionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` |
| Polygon   | PoolManager     | `0x67366782805870060151383f4bbff9dab53e5cd6` |
| Polygon   | UniversalRouter | `0x1095692a6237d83c6a72f3f5efedb9a670c49223` |
| Polygon   | PositionManager | `0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9` |
| BSC       | PoolManager     | `0x28e2ea090877bf75740558f6bfb36a5ffee9e9df` |
| BSC       | UniversalRouter | `0x1906c1d672b88cd1b9ac7593301ca990f94eae07` |
| BSC       | PositionManager | `0x7a4a5c919ae2541aed11041a1aeee68f1287f95b` |
| Avalanche | PoolManager     | `0x06380c0e0912312b5150364b9dc4542ba0dbbc85` |
| Avalanche | UniversalRouter | `0x94b75331ae8d42c1b61065089b7d48fe14aa73b7` |
| Avalanche | PositionManager | `0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd` |
| Blast     | PoolManager     | `0x1631559198a9e474033433b2958dabc135ab6446` |

## ABI Methods

### UniswapV4PoolManagerABI

- `initialize(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks), uint160 sqrtPriceX96) -> int24 tick` - Create and initialize a new pool with a starting price
- `swap(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks), tuple(bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96), bytes hookData) -> int256 delta` - Low-level swap (typically called through UniversalRouter, not directly)
- `modifyLiquidity(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks), tuple(int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt), bytes hookData) -> (int256 delta, int256 feeDelta)` - Low-level liquidity modification

### UniswapV4UniversalRouterABI

- `execute(bytes commands, bytes[] inputs, uint256 deadline)` - Execute a batch of commands (swap, settle, take, etc.) in sequence
- `execute(bytes commands, bytes[] inputs)` - The same, with no deadline

### UniswapV4PositionManagerABI

- `modifyLiquidities(bytes unlockData, uint256 deadline)` - Modify one or more liquidity positions in a single transaction

## Notes

- V4 uses a singleton architecture: ALL pools live in a single PoolManager contract, saving gas on multi-hop swaps
- Hooks: each pool can attach a custom hooks contract that intercepts before/after swap and liquidity events
- Pool key: `(currency0, currency1, fee, tickSpacing, hooks)` uniquely identifies a pool
- `currency0` = address(0) means native ETH; V4 supports native ETH directly (no WETH wrapping needed)
- `zeroForOne`: true = swap currency0 for currency1; false = swap currency1 for currency0
- `amountSpecified`: negative = exact input; positive = exact output
- Flash accounting: V4 uses transient storage for balance tracking within a transaction, settling at the end
- Commands/inputs for the UniversalRouter must be constructed off-chain; this is more complex than V3 but more powerful
- V4 is the newest Uniswap version; use it for advanced pool logic (custom hooks) or when gas efficiency on multi-hop matters most
- From a Pot program, `@sauce/router`'s `uniswapV4(poolManager, tokenIn, tokenOut, amountIn, fee, tickSpacing, hooks, sqrtPriceLimitX96, minOut, recipient)` swaps one pool through the Pot's Sauce Router, which unlocks the PoolManager, swaps, takes the output and settles the input from the Pot — no UniversalRouter and no approval. The pool key is `tokenIn` and `tokenOut` in sort order (native ETH, the zero address, first) with `fee`, `tickSpacing` and `hooks`; the function passes `-amountIn`, exact input, and returns the amount out. The `uniswapV4Swap` action is the same call
- On Arc (5042) the PositionManager's `WETH9()` is a stub that always reverts with `UnsupportedProtocolError()`. Arc's native coin is USDC at 18 decimals, so a pool keyed on `address(0)` is native USDC, a different currency from the 6-decimal ERC-20 `0x3600000000000000000000000000000000000000` over the same balance
