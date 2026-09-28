# Curve Finance

StableSwap AMM optimized for low-slippage swaps between pegged assets (stablecoins, wrapped tokens). Uses a specialized invariant that provides near-zero slippage for like-kind assets while maintaining AMM properties.

## Category

dex | Chains: Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, Fantom, Gnosis

## Key Operations

- **swap**: Exchange tokens within a pool using index-based routing
- **addLiquidity**: Add liquidity with flexible token amounts (can be imbalanced)
- **removeLiquidity**: Remove liquidity proportionally or single-sided

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/curve";
```

## SauceScript Examples

### swap

```typescript
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(
  poolAddress: Address,
  i: Uint256,
  j: Uint256,
  amountIn: Uint256,
  minAmountOut: Uint256,
): Uint256 {
  const pool = IStableSwap.at(poolAddress);
  return pool.exchange(i, j, amountIn, minAmountOut);
}
```

- `poolAddress`: The specific Curve pool contract address (each pool is a separate contract)
- `i`: Index of the input token within the pool (0-based)
- `j`: Index of the output token within the pool (0-based)
- `amountIn`: Exact amount of input token (in wei)
- `minAmountOut`: Minimum output for slippage protection
- Token indices vary per pool (e.g., 3pool: 0=DAI, 1=USDC, 2=USDT)

### addLiquidity

```typescript
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(poolAddress: Address, amounts: Uint256[], minMintAmount: Uint256): Uint256 {
  const pool = IStableSwap.at(poolAddress);
  return pool.add_liquidity(amounts, minMintAmount);
}
```

- `amounts`: Array of deposit amounts for each token in pool order (can include zeros for imbalanced deposits)
- `minMintAmount`: Minimum LP tokens to receive (slippage protection)
- All deposited tokens must be approved to the pool contract

### removeLiquidity

```typescript
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(poolAddress: Address, amount: Uint256, minAmounts: Uint256[]): Uint256[] {
  const pool = IStableSwap.at(poolAddress);
  return pool.remove_liquidity(amount, minAmounts);
}
```

- `amount`: Amount of LP tokens to burn
- `minAmounts`: Minimum amounts of each token to receive (array in pool token order)

## Key Addresses

| Chain     | Contract              | Address                                      |
| --------- | --------------------- | -------------------------------------------- |
| Ethereum  | RouterNG              | `0x16C6521Dff6baB339122a0FE25a9116693265353` |
| Ethereum  | AddressProvider       | `0x0000000022D53366457F9d5E68Ec105046FC4383` |
| Ethereum  | CRV Token             | `0xD533a949740bb3306d119CC777fa900bA034cd52` |
| Ethereum  | 3pool (DAI/USDC/USDT) | `0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7` |
| Arbitrum  | RouterNG              | `0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D` |
| Arbitrum  | AddressProvider       | `0x0000000022D53366457F9d5E68Ec105046FC4383` |
| Optimism  | RouterNG              | `0x0DCDED3545D565bA3B19E683431381007245d983` |
| Base      | RouterNG              | `0x4f37A9d177470499A2dD084621020b023fcffc1F` |
| Polygon   | AddressProvider       | `0x0000000022D53366457F9d5E68Ec105046FC4383` |
| Avalanche | AddressProvider       | `0x0000000022D53366457F9d5E68Ec105046FC4383` |
| Fantom    | AddressProvider       | `0x0000000022D53366457F9d5E68Ec105046FC4383` |
| Gnosis    | AddressProvider       | `0x0000000022D53366457F9d5E68Ec105046FC4383` |

## ABI Methods

### CurveStableSwapABI

The StableSwap-NG pool interface. Legacy pools such as 3pool share the selectors of `exchange`, `get_dy`, `remove_liquidity_one_coin` and `get_virtual_price`, but their `exchange` and `remove_liquidity_one_coin` return nothing (so the declared `uint256` output reverts on them) and their liquidity functions take fixed-size arrays (`uint256[3]`). Read legacy pools with `get_dy`/`get_virtual_price` only.

- `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) -> uint256` - Swap between two tokens in the pool by index
- `exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) -> uint256` - Swap between underlying tokens (metapools only)
- `add_liquidity(uint256[] amounts, uint256 min_mint_amount) -> uint256` - Deposit tokens and receive LP tokens (can be imbalanced)
- `remove_liquidity(uint256 _amount, uint256[] min_amounts) -> uint256[]` - Burn LP tokens and withdraw all tokens proportionally
- `remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount) -> uint256` - Burn LP tokens and withdraw as a single token
- `get_dy(int128 i, int128 j, uint256 dx) -> uint256` - Quote: estimate output for a given input (view)
- `get_virtual_price() -> uint256` - Get the virtual price of the LP token (view, useful for pricing)

### CurveRouterNGABI

- `exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _expected, address[5] _pools) -> uint256` - Multi-pool routed swap for optimal execution
- `get_dy(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, address[5] _pools) -> uint256` - Quote routed swap output (view)

### CurveAddressProviderABI

- `get_registry() -> address` - Get the main registry contract address (view)
- `get_address(uint256 _id) -> address` - Get a specific system contract by ID (view)

## Notes

- Pool tokens are indexed (i, j) not addressed; you must know the token order for each pool
- Common pool token orders: 3pool = [DAI(0), USDC(1), USDT(2)]
- `exchange_underlying` is used for metapools or lending pools where tokens wrap underlying assets
- `remove_liquidity_one_coin` is useful for single-sided withdrawal (higher slippage than proportional)
- Each pool is a separate contract; use the AddressProvider or registry to discover pools
- RouterNG enables cross-pool routing for multi-hop swaps across different pools
- Curve excels at stablecoin swaps (much lower slippage than Uniswap for like-kind pairs)
- The `get_virtual_price` never decreases and represents the LP token value growth over time
- Tokens must be ERC20-approved to the pool contract (not a router) for direct pool swaps
- For Router NG swaps, approve tokens to the Router NG contract
