# Pendle

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Yield trading protocol that tokenizes future yield. Split yield-bearing assets into principal tokens (PT) and yield tokens (YT) for trading. PT = discounted principal (fixed yield), YT = future variable yield.

## Category

yield | Chains: Ethereum, Arbitrum

## Key Operations

- **swapExactTokenForPt**: Buy PT (principal token) - lock in fixed yield
- **swapExactTokenForYt**: Buy YT (yield token) - speculate on variable yield
- **addLiquiditySingleToken**: Add single-sided liquidity to a Pendle market
- **removeLiquiditySingleToken**: Remove liquidity and receive single token

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  swapExactTokenForPt,
  swapExactTokenForYt,
  addLiquiditySingleToken,
  removeLiquiditySingleToken,
} from "@eco-incorp/sauce/protocols/pendle";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | router   | `0x888888888889758F76e7103c6CbF23ABbF58F946` |
| Arbitrum | router   | `0x888888888889758F76e7103c6CbF23ABbF58F946` |

## ABI Methods

### PendleRouterABI

- `swapExactTokenForPt(address,address,uint256,tuple,tuple,tuple)` - Buy PT. Complex params: receiver, market, minPtOut, ApproxParams, TokenInput, LimitOrderData
- `swapExactTokenForYt(address,address,uint256,tuple,tuple,tuple)` - Buy YT. Same param structure as swapExactTokenForPt
- `addLiquiditySingleToken(address,address,uint256,tuple,tuple,tuple)` - Add single-sided liquidity. Params: receiver, market, minLpOut, ApproxParams, TokenInput, LimitOrderData
- `removeLiquiditySingleToken(address,address,uint256,tuple,tuple)` - Remove liquidity. Params: receiver, market, netLpToRemove, TokenOutput, LimitOrderData

### Param Structs

- **ApproxParams**: { guessMin, guessMax, guessOffchain, maxIteration, eps } - Binary search params for PT/YT amount
- **TokenInput**: { tokenIn, netTokenIn, tokenMintSy, pendleSwap, swapData } - Input token config
- **TokenOutput**: { tokenOut, minTokenOut, tokenRedeemSy, pendleSwap, swapData } - Output token config
- **SwapData**: { swapType, extRouter, extCalldata, needScale } - External swap config (use zeros for direct)
- **LimitOrderData**: { limitRouter, epsSkipMarket, normalFills, flashFills, optData } - Limit orders (use zeros/empty)

## Notes

- TVL: $2.6B+. Markets have expiry dates - PT redeems at face value at maturity
- All router methods use complex tuple params - see struct definitions above
- For simple swaps without external routing: set pendleSwap to zero address, swapType to 0
- For limit orders: set limitRouter to zero address, empty arrays for fills
- ApproxParams eps is typically 1e15 (0.1%), maxIteration typically 256
- tokenMintSy = the token that the SY (standardized yield) wrapper accepts
