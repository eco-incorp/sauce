<!-- Generated from the SDK's registries. Do not edit. -->

# SyncSwap (`syncswap`)

The leading DEX on zkSync Era with optimized gas efficiency. Supports classic constant product and stable pools with native account abstraction.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Syncswap` on zksync |
| Chains | zksync |
| Document | [syncswap.md](../syncswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On zkSync Era, `Syncswap` is a namespace: its contracts need no import.

```sauce chain=zksync
function main() {
  // zkSync Era's router, `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295`.
  require(Syncswap.Router != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | router | `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295` | `Syncswap.Router` |

## ABI

### `SyncSwapRouterABI`

`import SyncSwapRouterABI from "./protocols/syncswap/SyncSwapRouterABI.json";` Speaks for: router.

- `swap(((address pool, bytes data, address callback, bytes callbackData)[] steps, address tokenIn, uint256 amountIn)[] paths, uint256 amountOutMin, uint256 deadline) payable returns ((address token, uint256 amount) amountOut)`
