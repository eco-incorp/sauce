# SyncSwap

The leading DEX on zkSync Era with optimized gas efficiency for the ZK rollup environment. Supports classic constant product pools and stable pools with native account abstraction support.

## Category

dex | Chains: zkSync

## Key Operations

- **swap**: Swap tokens via path-based routing with encoded swap data and step-based execution

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/syncswap";
```

## SauceScript Examples

### swap

```typescript
import { SyncSwapRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  pool: Address,
  tokenIn: Address,
  amountIn: Uint256,
  amountOutMin: Uint256,
  swapData: bytes,
): { token: Address; amount: Uint256 } {
  const router = IRouter.at(routerAddress);
  const zeroAddr = 0x0000000000000000000000000000000000000000;
  return router.swap(
    [
      {
        steps: [{ pool: pool, data: swapData, callback: zeroAddr, callbackData: 0x00 }],
        tokenIn: tokenIn,
        amountIn: amountIn,
      },
    ],
    amountOutMin,
    99999999999,
  );
}
```

- `routerAddress`: SyncSwap Router on zkSync (`0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295`)
- `pool`: The specific pool contract address to swap through
- `tokenIn`: Input token address
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `swapData`: ABI-encoded bytes containing `(address tokenIn, address recipient, uint8 withdrawMode)`. Withdraw modes: `0` = vault deposit, `1` = withdraw to wallet, `2` = unwrap WETH
- `callback`: Set to zero address for standard swaps (no callback)
- `callbackData`: Set to `0x00` for standard swaps
- Supports multi-step paths: add more entries to the `steps` array for multi-hop

## Key Addresses

| Chain  | Contract | Address                                      |
| ------ | -------- | -------------------------------------------- |
| zkSync | Router   | `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295` |

## ABI Methods

### SyncSwapRouterABI

- `swap(tuple[](tuple[](address pool, bytes data, address callback, bytes callbackData) steps, address tokenIn, uint256 amountIn) paths, uint256 amountOutMin, uint256 deadline) -> tuple(address token, uint256 amount) amountOut` - Execute a swap through one or more paths, each containing one or more pool steps

## Notes

- Swap data (`data` field in steps) must be ABI-encoded off-chain: `abi.encode(tokenIn, recipient, withdrawMode)`
- `withdrawMode`: `0` = keep in vault (for chaining), `1` = withdraw to user wallet, `2` = unwrap WETH to native ETH
- Each path can have multiple steps (multi-hop), and you can include multiple paths in one transaction
- Steps support callbacks for flash-swap-like patterns (set to zero address for standard swaps)
- Pool addresses must be discovered off-chain (via SyncSwap's factory or API)
- zkSync-only deployment; optimized for zkSync Era's unique execution environment
- Input token must be ERC20-approved to the Router
