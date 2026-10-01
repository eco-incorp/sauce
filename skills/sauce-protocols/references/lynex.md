# Lynex

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Linea-native ve(3,3) DEX and liquidity marketplace. Solidly-fork with gauge voting and support for both stable and volatile pool types on the Linea zkEVM network.

## Category

dex | Chains and addresses: [registry/lynex.md](registry/lynex.md)

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { LynexRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  stable: bool,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    [{ from: tokenIn, to: tokenOut, stable: stable }],
    recipient,
    99999999999,
  );
}
```

- `routerAddress`: Lynex Router on Linea (`0x610D2f07b7EdC67565160F587F37636194C34E74`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets), `false` for volatile pools (uncorrelated)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Routes support multi-hop: `[{from: A, to: B, stable: false}, {from: B, to: C, stable: true}]`
- Note: Lynex routes do NOT include a `factory` field (unlike Velodrome/Aerodrome)

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/lynex.md](registry/lynex.md).

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: LYNX token holders vote-lock to direct gauge emissions
- Linea-only deployment; the dominant DEX on Linea zkEVM
- LP tokens can be staked in gauges for LYNX emissions
- Input token must be ERC20-approved to the Router
