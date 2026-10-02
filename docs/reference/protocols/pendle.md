<!-- Generated from the SDK's registries. Do not edit. -->

# Pendle (`pendle`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Yield trading protocol that tokenizes future yield. Split yield-bearing assets into principal tokens (PT) and yield tokens (YT) for trading. PT = discounted principal (fixed yield), YT = future variable yield.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Pendle` on ethereum, monad, arbitrum |
| Chains | ethereum, monad, arbitrum |

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

```ts
function main(tokenIn: Address, amountIn: Uint256, pt: Address, minPtOut: Uint256, call: bytes) {
  const self = ctx.self();
  const before = Token(pt).balanceOf(self);
  Token(tokenIn).approve(Pendle.Router, amountIn);
  evm.call(Pendle.Router, 0n, call);
  const out = Token(pt).balanceOf(self) - before;
  require(out >= minPtOut, "below minPtOut");
}
```

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

## Its names in a program

On Ethereum, `Pendle` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's router, `0x888888888889758F76e7103c6CbF23ABbF58F946`.
  require(Pendle.Router != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Monad](../chains/monad.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |

## ABI

### `PendleRouterABI`

`import PendleRouterABI from "./protocols/pendle/PendleRouterABI.json";` Speaks for: router.

- `addLiquiditySingleToken(address receiver, address market, uint256 minLpOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtReceivedFromSy, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netLpOut, uint256 netSyFee, uint256 netSyInterm)`
- `removeLiquiditySingleToken(address receiver, address market, uint256 netLpToRemove, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactTokenForPt(address receiver, address market, uint256 minPtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactTokenForYt(address receiver, address market, uint256 minYtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessYtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netYtOut, uint256 netSyFee, uint256 netSyInterm)`
