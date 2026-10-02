# Pendle

> **In a Sauce program**, swap with `@sauce/router`, one function per venue with a minimum output, and a price limit where the pool takes one (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Yield trading protocol that tokenizes future yield. Split yield-bearing assets into principal tokens (PT) and yield tokens (YT) for trading. PT = discounted principal (fixed yield), YT = future variable yield.

## When to use it

- Splits a yield-bearing asset into PT (the principal, redeemable for the underlying at the
  market's expiry: a fixed yield) and YT (the yield until then), each traded in a market per
  expiry.
- Choose PT to lock a fixed yield to a date, YT to speculate on the yield.

## Pitfalls for a program

- Each market has an expiry: PT trades below the underlying before it, and redeems at it.
- Router calls take approximation and routing structs that Pendle's own API usually builds:
  take that calldata as `main`'s input, approve the input, forward it, and check the PT you
  got as a delta.
- PT and YT are separate tokens per market: name the right one.

## In a Sauce program

Buy PT with calldata from Pendle's API, checked by the PT received:

```sauce chain=arbitrum,ethereum
function main(tokenIn: Address, amountIn: Uint256, pt: Address, minPtOut: Uint256, call: bytes) {
  const self = ctx.self();
  const before = Token(pt).balanceOf(self);
  Token(tokenIn).approve(Pendle.Router, amountIn);
  evm.call(Pendle.Router, 0n, call);
  const out = Token(pt).balanceOf(self) - before;
  require(out >= minPtOut, "below minPtOut");
}
```

## Category

yield | Chains and addresses: [registry/pendle.md](registry/pendle.md)

## Key Operations

- **swapExactTokenForPt**: Buy PT (principal token) - lock in fixed yield
- **swapExactTokenForYt**: Buy YT (yield token) - speculate on variable yield
- **addLiquiditySingleToken**: Add single-sided liquidity to a Pendle market
- **removeLiquiditySingleToken**: Remove liquidity and receive single token

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Buy PT (fixed yield)
import { PendleRouterABI as IPendleRouter } from "./abis";
function main(
  routerAddress: Address,
  receiver: Address,
  market: Address,
  minPtOut: Uint256,
  guessMin: Uint256,
  guessMax: Uint256,
  guessOffchain: Uint256,
  maxIteration: Uint256,
  eps: Uint256,
  tokenIn: Address,
  netTokenIn: Uint256,
  tokenMintSy: Address,
): { netPtOut: Uint256; netSyFee: Uint256; netSyInterm: Uint256 } {
  const router = IPendleRouter.at(routerAddress);
  const result = router.swapExactTokenForPt(
    receiver,
    market,
    minPtOut,
    {
      guessMin: guessMin,
      guessMax: guessMax,
      guessOffchain: guessOffchain,
      maxIteration: maxIteration,
      eps: eps,
    },
    {
      tokenIn: tokenIn,
      netTokenIn: netTokenIn,
      tokenMintSy: tokenMintSy,
      pendleSwap: 0x0000000000000000000000000000000000000000,
      swapData: {
        swapType: 0,
        extRouter: 0x0000000000000000000000000000000000000000,
        extCalldata: 0x00,
        needScale: false,
      },
    },
    {
      limitRouter: 0x0000000000000000000000000000000000000000,
      epsSkipMarket: 0,
      normalFills: [],
      flashFills: [],
      optData: 0x00,
    },
  );
  return result;
}

// Remove liquidity
import { PendleRouterABI as IPendleRouter } from "./abis";
function main(
  routerAddress: Address,
  receiver: Address,
  market: Address,
  netLpToRemove: Uint256,
  tokenOut: Address,
  minTokenOut: Uint256,
  tokenRedeemSy: Address,
): { netTokenOut: Uint256; netSyFee: Uint256; netSyInterm: Uint256 } {
  const router = IPendleRouter.at(routerAddress);
  const result = router.removeLiquiditySingleToken(
    receiver,
    market,
    netLpToRemove,
    {
      tokenOut: tokenOut,
      minTokenOut: minTokenOut,
      tokenRedeemSy: tokenRedeemSy,
      pendleSwap: 0x0000000000000000000000000000000000000000,
      swapData: {
        swapType: 0,
        extRouter: 0x0000000000000000000000000000000000000000,
        extCalldata: 0x00,
        needScale: false,
      },
    },
    {
      limitRouter: 0x0000000000000000000000000000000000000000,
      epsSkipMarket: 0,
      normalFills: [],
      flashFills: [],
      optData: 0x00,
    },
  );
  return result;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/pendle.md](registry/pendle.md).

## Notes

- TVL: $2.6B+. Markets have expiry dates - PT redeems at face value at maturity
- All router methods use complex tuple params - see struct definitions above
- For simple swaps without external routing: set pendleSwap to zero address, swapType to 0
- For limit orders: set limitRouter to zero address, empty arrays for fills
- ApproxParams eps is typically 1e15 (0.1%), maxIteration typically 256
- tokenMintSy = the token that the SY (standardized yield) wrapper accepts
- **ApproxParams**: { guessMin, guessMax, guessOffchain, maxIteration, eps } - Binary search params for PT/YT amount
- **TokenInput**: { tokenIn, netTokenIn, tokenMintSy, pendleSwap, swapData } - Input token config
- **TokenOutput**: { tokenOut, minTokenOut, tokenRedeemSy, pendleSwap, swapData } - Output token config
- **SwapData**: { swapType, extRouter, extCalldata, needScale } - External swap config (use zeros for direct)
- **LimitOrderData**: { limitRouter, epsSkipMarket, normalFills, flashFills, optData } - Limit orders (use zeros/empty)
