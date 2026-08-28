export const swapExactTokenForPt = `
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
  tokenMintSy: Address
): { netPtOut: Uint256, netSyFee: Uint256, netSyInterm: Uint256 } {
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
      eps: eps
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
        needScale: false
      }
    },
    {
      limitRouter: 0x0000000000000000000000000000000000000000,
      epsSkipMarket: 0,
      normalFills: [],
      flashFills: [],
      optData: 0x00
    }
  );
  return result;
}
`;

export const swapExactTokenForYt = `
import { PendleRouterABI as IPendleRouter } from "./abis";

function main(
  routerAddress: Address,
  receiver: Address,
  market: Address,
  minYtOut: Uint256,
  guessMin: Uint256,
  guessMax: Uint256,
  guessOffchain: Uint256,
  maxIteration: Uint256,
  eps: Uint256,
  tokenIn: Address,
  netTokenIn: Uint256,
  tokenMintSy: Address
): { netYtOut: Uint256, netSyFee: Uint256, netSyInterm: Uint256 } {
  const router = IPendleRouter.at(routerAddress);
  const result = router.swapExactTokenForYt(
    receiver,
    market,
    minYtOut,
    {
      guessMin: guessMin,
      guessMax: guessMax,
      guessOffchain: guessOffchain,
      maxIteration: maxIteration,
      eps: eps
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
        needScale: false
      }
    },
    {
      limitRouter: 0x0000000000000000000000000000000000000000,
      epsSkipMarket: 0,
      normalFills: [],
      flashFills: [],
      optData: 0x00
    }
  );
  return result;
}
`;

export const addLiquiditySingleToken = `
import { PendleRouterABI as IPendleRouter } from "./abis";

function main(
  routerAddress: Address,
  receiver: Address,
  market: Address,
  minLpOut: Uint256,
  guessMin: Uint256,
  guessMax: Uint256,
  guessOffchain: Uint256,
  maxIteration: Uint256,
  eps: Uint256,
  tokenIn: Address,
  netTokenIn: Uint256,
  tokenMintSy: Address
): { netLpOut: Uint256, netSyFee: Uint256, netSyInterm: Uint256 } {
  const router = IPendleRouter.at(routerAddress);
  const result = router.addLiquiditySingleToken(
    receiver,
    market,
    minLpOut,
    {
      guessMin: guessMin,
      guessMax: guessMax,
      guessOffchain: guessOffchain,
      maxIteration: maxIteration,
      eps: eps
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
        needScale: false
      }
    },
    {
      limitRouter: 0x0000000000000000000000000000000000000000,
      epsSkipMarket: 0,
      normalFills: [],
      flashFills: [],
      optData: 0x00
    }
  );
  return result;
}
`;

export const removeLiquiditySingleToken = `
import { PendleRouterABI as IPendleRouter } from "./abis";

function main(
  routerAddress: Address,
  receiver: Address,
  market: Address,
  netLpToRemove: Uint256,
  tokenOut: Address,
  minTokenOut: Uint256,
  tokenRedeemSy: Address
): { netTokenOut: Uint256, netSyFee: Uint256, netSyInterm: Uint256 } {
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
        needScale: false
      }
    },
    {
      limitRouter: 0x0000000000000000000000000000000000000000,
      epsSkipMarket: 0,
      normalFills: [],
      flashFills: [],
      optData: 0x00
    }
  );
  return result;
}
`;
