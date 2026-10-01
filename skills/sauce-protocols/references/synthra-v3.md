# Synthra V3

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Concentrated-liquidity spot DEX on Arc: a Uniswap V3 fork with renamed pool callbacks.

## Category

dex | Chains and addresses: [registry/synthra-v3.md](registry/synthra-v3.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

Exact-input single-hop swap through SwapRouter02.

```typescript
import { SynthraV3SwapRouter02ABI as ISwapRouter02 } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ISwapRouter02.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0,
  });
}
```

- SwapRouter02's params have no `deadline`
- `tokenIn` must be `approve`d to the router

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/synthra-v3.md](registry/synthra-v3.md).

## Notes

- The external ABIs are Uniswap V3's (`getPool`, `exactInputSingle`, `quoteExactInputSingle`, `mint`, …), and the Arc bytecode dispatches every one of them
- Pools call back `synthraV3SwapCallback` (`0x13abb0ca`) and `synthraV3MintCallback`, not the `uniswapV3*` callbacks, so a contract that swaps or mints against a Synthra pool directly must implement the renamed callbacks
- On Arc there is no wrapped native token; pools pair against USDC's ERC-20 interface `0x3600…0000`
- Addresses come from docs.synthra.org's contract-addresses page
