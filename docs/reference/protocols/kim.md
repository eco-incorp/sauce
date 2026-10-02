<!-- Generated from the SDK's registries. Do not edit. -->

# Kim (`kim`)

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Mode-native DEX. Its V2 router is a Camelot fork: swaps take a plain token path and a referrer, and support fee-on-transfer tokens. The primary trading venue on Mode Network with farming incentives.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Kim` on mode |
| Chains | mode |

## Key Operations

- **swap**: Swap tokens along a token path

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { KimRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = IRouter.at(routerAddress);
  router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    amountIn,
    amountOutMin,
    [tokenIn, tokenOut],
    recipient,
    0x0000000000000000000000000000000000000000,
    99999999999,
  );
  return 1;
}
```

- `routerAddress`: Kim Router on Mode (`0x5D61c537393cf21893BE619E36fC94cd73C77DD3`)
- `tokenIn` / `tokenOut`: Input and output token addresses; a longer path swaps through intermediate tokens
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- The swap returns nothing: measure the output as the recipient's balance change

## Notes

- Mode-only deployment; the dominant DEX on Mode Network
- Mode Network features native yield sharing via Sequencer Fee Sharing (SFS)
- LP tokens can be staked for farming rewards
- Input token must be ERC20-approved to the Router

## Its names in a program

On Mode, `Kim` is a namespace: its contracts need no import.

```ts
function main() {
  // Mode's v2Router, `0x5D61c537393cf21893BE619E36fC94cd73C77DD3`.
  require(Kim.V2Router != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Mode](../chains/mode.md) | v2Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` | `Kim.V2Router` |

## ABI

### `KimRouterABI`

`import KimRouterABI from "./protocols/kim/KimRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
