# Kim

> **In a Sauce program**, swap with `@sauce/router`, one function per venue with a minimum output, and a price limit where the pool takes one (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Mode-native DEX. Its V2 router is a Camelot fork: swaps take a plain token path and a referrer, and support fee-on-transfer tokens. The primary trading venue on Mode Network with farming incentives.

## Category

dex | Chains and addresses: [registry/kim.md](registry/kim.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/kim.md](registry/kim.md).

## Notes

- Mode-only deployment; the dominant DEX on Mode Network
- Mode Network features native yield sharing via Sequencer Fee Sharing (SFS)
- LP tokens can be staked for farming rewards
- Input token must be ERC20-approved to the Router
