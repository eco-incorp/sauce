# MUX Protocol

Leveraged trading aggregator on Arbitrum. Routes trades across multiple perpetual DEXs for best execution with shared liquidity pool.

## Category

perpetuals | Chains: Arbitrum

## Key Operations

- **addLiquidity**: Add liquidity to MUX pool (receive MLP tokens)
- **removeLiquidity**: Remove liquidity from pool (burn MLP tokens)
- **placePositionOrder**: Place a leveraged position order
- **cancelOrder**: Cancel a pending order

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/mux-protocol";
```

## SauceScript Examples

```typescript
// Add liquidity to MUX pool
import { LiquidityPoolABI as ILiquidityPool } from "./abis";
function main(poolAddress: Address, tokenId: Uint256, tokenAmount: Uint256): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.addLiquidity(tokenId, tokenAmount);
  return 1;
}

// Remove liquidity from MUX pool
import { LiquidityPoolABI as ILiquidityPool } from "./abis";
function main(poolAddress: Address, tokenId: Uint256, mlpAmount: Uint256): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.removeLiquidity(tokenId, mlpAmount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| Arbitrum | orderBook     | `0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3` |
| Arbitrum | liquidityPool | `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633` |

## ABI Methods

### OrderBookABI

- `placePositionOrder(bytes32,uint256,uint256,uint256,uint8,uint8,uint32,bytes32)` - Place leveraged position order. Params: subAccountId (encodes account+collateral+asset+isLong), collateralAmount, size (position size), price, profitTokenId, flags (order type bits), deadline, referralCode. Payable (execution fee)
- `cancelOrder(uint64)` - Cancel pending order. Params: orderId

### LiquidityPoolABI

- `addLiquidity(uint8,uint256)` - Add liquidity. Params: tokenId (asset index), tokenAmount. Approve token to pool first
- `removeLiquidity(uint8,uint256)` - Remove liquidity. Params: tokenId (asset to receive), mlpAmount (MLP tokens to burn)

## Notes

- Aggregates perpetual DEXs (GMX, Gains, etc.) for optimal trade execution
- subAccountId (bytes32) encodes: account address + collateral token ID + asset ID + isLong flag
- tokenId is a uint8 index identifying the collateral asset (0=ETH, 1=BTC, etc.)
- MLP is the liquidity provider token
- Position orders require ETH execution fee sent as msg.value
