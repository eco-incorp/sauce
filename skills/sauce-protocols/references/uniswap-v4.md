# Uniswap V4

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Singleton AMM with hooks architecture enabling custom pool logic, flash accounting, and native ETH support. All pools share a single PoolManager contract for gas savings on multi-hop swaps.

## Category

dex | Chains and addresses: [registry/uniswap-v4.md](registry/uniswap-v4.md)

## Key Operations

- **swap**: Execute a swap through the UniversalRouter using command-based encoding
- **addLiquidity**: Modify liquidity positions through the PositionManager
- **removeLiquidity**: Decrease or remove liquidity positions through the PositionManager

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/uniswap-v4.md](registry/uniswap-v4.md).

## Notes

- V4 uses a singleton architecture: ALL pools live in a single PoolManager contract, saving gas on multi-hop swaps
- Hooks: each pool can attach a custom hooks contract that intercepts before/after swap and liquidity events
- Pool key: `(currency0, currency1, fee, tickSpacing, hooks)` uniquely identifies a pool
- `currency0` = address(0) means native ETH; V4 supports native ETH directly (no WETH wrapping needed)
- `zeroForOne`: true = swap currency0 for currency1; false = swap currency1 for currency0
- `amountSpecified`: negative = exact input; positive = exact output (the reverse of Uniswap V3's pool `swap`)
- Flash accounting: V4 uses transient storage for balance tracking within a transaction, settling at the end
- Commands/inputs for the UniversalRouter must be constructed off-chain; this is more complex than V3 but more powerful
- A Sauce program needs no UniversalRouter commands: the Sauce Router's `swapV4(poolManager, key, zeroForOne, -amount, sqrtPriceLimitX96, payer, recipient)` unlocks the PoolManager and settles the swap itself (`sauce-swaps`)
- V4 is the newest Uniswap version; use it for advanced pool logic (custom hooks) or when gas efficiency on multi-hop matters most
- On Arc (5042) the PositionManager's `WETH9()` is a stub that always reverts with `UnsupportedProtocolError()`. Arc's native coin is USDC at 18 decimals, so a pool keyed on `address(0)` is native USDC, a different currency from the 6-decimal ERC-20 `0x3600000000000000000000000000000000000000` over the same balance
