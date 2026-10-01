<!-- Generated from the SDK's registries. Do not edit. -->

# SyncSwap (`syncswap`)

The leading DEX on zkSync Era with optimized gas efficiency. Supports classic constant product and stable pools with native account abstraction.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | zksync |
| Document | [syncswap.md](../syncswap.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here zkSync Era's router):

```sauce chain=zksync
import SyncSwapRouterABI from "./protocols/syncswap/SyncSwapRouterABI.json";

const ROUTER = 0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295n;

function main() {
  const bound = SyncSwapRouterABI.at(ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | router | `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295` | `SyncSwapRouterABI.at(0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295n)` |

## ABI

### `SyncSwapRouterABI`

`import SyncSwapRouterABI from "./protocols/syncswap/SyncSwapRouterABI.json";` Speaks for: router.

- `swap(((address pool, bytes data, address callback, bytes callbackData)[] steps, address tokenIn, uint256 amountIn)[] paths, uint256 amountOutMin, uint256 deadline) payable returns ((address token, uint256 amount) amountOut)`
