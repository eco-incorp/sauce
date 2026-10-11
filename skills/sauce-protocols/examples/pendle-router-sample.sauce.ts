// Pendle's router samples, ported: `RouterSample` is Pendle's tour of its router, as tests that
// each spend 1 wstETH one way and turn what it bought back into wstETH: buy and sell PT, buy and
// sell YT, zap into a market's liquidity and out, mint and redeem SY, and mint and redeem PT with
// YT; and a zap that keeps the YT. Here `step` picks one, spending `amount` of `token` (one the
// market's SY takes), and returns what the first leg bought and what the second paid back, which
// must be at least `minBack`.
//
// Ported from pendle-finance/pendle-examples-public, test/RouterSample.sol (265 lines, 204 of code):
// https://github.com/pendle-finance/pendle-examples-public/blob/642b1ab2784b3015691d6c26a2684cd5f7585b0d/test/RouterSample.sol
//
// What changes in Sauce: the samples are tests on a fork, with `deal` for their wstETH and every
// token approved to the router for the maximum; the Pot spends its own `token` and approves each
// call for what it spends. Their market was a constant; `market` is an input. Their minimums were
// 0; `minBack` bounds the round trip. The YT sample sells the YT the router reports, a hair less
// than it delivers; the program sells what arrived. Their StructGen helpers are the functions
// below. Three samples are left out: the rewards one warps time on a fork; the one that batches
// two router calls through the router's own batching, which a program makes one after the other;
// and the try/catch claim, which probes a token's kind. The router functions the registry's ABI leaves out, and the market's
// `readTokens`, are in PendleRouterSample.json beside this file.
//
//   sauce run pendle-router-sample.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <step> <market> <token> <amount> <minBack>
//
//   step: Uint256       1 buy and sell PT, 2 buy and sell YT, 3 zap in and out, 4 mint and redeem
//                       SY, 5 mint and redeem PT and YT, 6 zap in keeping the YT
//   market: Address     the Pendle market, before its expiry
//   token: Address      the token spent and paid back: one its SY takes in and pays out
//   amount: Uint256     how much `token`, in its smallest units:
//                       1000000000000000000 is 1 wstETH (18 decimals)
//   minBack: Uint256    the least `token` the second leg must pay back (step 6: the least LP)
//
// On Ethereum, 1 wstETH through PT and back, on the wstETH market:
//
//   sauce run pendle-router-sample.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 1 <market> 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0 1000000000000000000 <minBack>
import PendleRouterSample from "./PendleRouterSample.json";

interface Legs {
  out: Uint256;
  back: Uint256;
}

// StructGen's helpers: the router searches the trade's size on chain within `defaultApprox`'s
// bounds, and no aggregator swap and no limit order is used. Each returns a record the compiler
// builds where it is used.
function defaultApprox() {
  return { guessMin: 0, guessMax: ~0, guessOffchain: 0, maxIteration: 256, eps: 10 ** 14 };
}

function noSwap() {
  return { swapType: 0, extRouter: 0, extCalldata: hex``, needScale: false };
}

function createTokenInputStruct(tokenIn: Address, netTokenIn: Uint256) {
  return { tokenIn, netTokenIn, tokenMintSy: tokenIn, pendleSwap: 0, swapData: noSwap() };
}

function createTokenOutputStruct(tokenOut: Address, minTokenOut: Uint256) {
  return { tokenOut, minTokenOut, tokenRedeemSy: tokenOut, pendleSwap: 0, swapData: noSwap() };
}

function emptyLimit() {
  return { limitRouter: 0, epsSkipMarket: 0, normalFills: [], flashFills: [], optData: hex`` };
}

function buyAndSellPt(market: Address, token: Address, amount: Uint256, minBack: Uint256): Legs {
  require(Pendle.Router);
  const router = PendleRouterSample.at(Pendle.Router);
  const [, pt] = PendleRouterSample.at(market).readTokens();
  approve(token, Pendle.Router, amount);
  const [netPtOut] = Pendle.Router.swapExactTokenForPt(
    ctx.self(),
    market,
    0,
    defaultApprox(),
    createTokenInputStruct(token, amount),
    emptyLimit(),
  );
  approve(pt, Pendle.Router, netPtOut);
  const [netTokenOut] = router.swapExactPtForToken(
    ctx.self(),
    market,
    netPtOut,
    createTokenOutputStruct(token, minBack),
    emptyLimit(),
  );
  return { out: netPtOut, back: netTokenOut };
}

function buyAndSellYt(market: Address, token: Address, amount: Uint256, minBack: Uint256): Legs {
  require(Pendle.Router);
  const router = PendleRouterSample.at(Pendle.Router);
  const [, , yt] = PendleRouterSample.at(market).readTokens();
  const ytBefore = Token(yt).balanceOf(ctx.self());
  approve(token, Pendle.Router, amount);
  Pendle.Router.swapExactTokenForYt(
    ctx.self(),
    market,
    0,
    defaultApprox(),
    createTokenInputStruct(token, amount),
    emptyLimit(),
  );
  // The router reports a hair less YT than it delivers; selling what arrived leaves none behind.
  const netYtOut = Token(yt).balanceOf(ctx.self()) - ytBefore;
  approve(yt, Pendle.Router, netYtOut);
  const [netTokenOut] = router.swapExactYtForToken(
    ctx.self(),
    market,
    netYtOut,
    createTokenOutputStruct(token, minBack),
    emptyLimit(),
  );
  return { out: netYtOut, back: netTokenOut };
}

function zapInAndZapOut(market: Address, token: Address, amount: Uint256, minBack: Uint256): Legs {
  require(Pendle.Router);
  approve(token, Pendle.Router, amount);
  const [netLpOut] = Pendle.Router.addLiquiditySingleToken(
    ctx.self(),
    market,
    0,
    defaultApprox(),
    createTokenInputStruct(token, amount),
    emptyLimit(),
  );
  approve(market, Pendle.Router, netLpOut);
  const [netTokenOut] = Pendle.Router.removeLiquiditySingleToken(
    ctx.self(),
    market,
    netLpOut,
    createTokenOutputStruct(token, minBack),
    emptyLimit(),
  );
  return { out: netLpOut, back: netTokenOut };
}

function mintRedeemSy(market: Address, token: Address, amount: Uint256, minBack: Uint256): Legs {
  require(Pendle.Router);
  const router = PendleRouterSample.at(Pendle.Router);
  const [sy] = PendleRouterSample.at(market).readTokens();
  approve(token, Pendle.Router, amount);
  const netSyOut = router.mintSyFromToken(ctx.self(), sy, 0, createTokenInputStruct(token, amount));
  approve(sy, Pendle.Router, netSyOut);
  const netTokenOut = router.redeemSyToToken(
    ctx.self(),
    sy,
    netSyOut,
    createTokenOutputStruct(token, minBack),
  );
  return { out: netSyOut, back: netTokenOut };
}

function mintRedeemPtAndYt(
  market: Address,
  token: Address,
  amount: Uint256,
  minBack: Uint256,
): Legs {
  require(Pendle.Router);
  const router = PendleRouterSample.at(Pendle.Router);
  const [, pt, yt] = PendleRouterSample.at(market).readTokens();
  approve(token, Pendle.Router, amount);
  const [netPyOut] = router.mintPyFromToken(
    ctx.self(),
    yt,
    0,
    createTokenInputStruct(token, amount),
  );
  // Redeeming burns an equal amount of PT and YT.
  approve(pt, Pendle.Router, netPyOut);
  approve(yt, Pendle.Router, netPyOut);
  const [netTokenOut] = router.redeemPyToToken(
    ctx.self(),
    yt,
    netPyOut,
    createTokenOutputStruct(token, minBack),
  );
  return { out: netPyOut, back: netTokenOut };
}

// The zap with no price impact: the YT it mints along the way is kept, and the LP is all it adds.
function zeroPriceImpactZap(
  market: Address,
  token: Address,
  amount: Uint256,
  minLpOut: Uint256,
): Legs {
  require(Pendle.Router);
  approve(token, Pendle.Router, amount);
  const [netLpOut, netYtOut] = PendleRouterSample.at(Pendle.Router).addLiquiditySingleTokenKeepYt(
    ctx.self(),
    market,
    minLpOut,
    0,
    createTokenInputStruct(token, amount),
  );
  return { out: netLpOut, back: netYtOut };
}

function main(
  step: Uint256,
  market: Address,
  token: Address,
  amount: Uint256,
  minBack: Uint256,
): Legs {
  if (step == 1) {
    return buyAndSellPt(market, token, amount, minBack);
  }
  if (step == 2) {
    return buyAndSellYt(market, token, amount, minBack);
  }
  if (step == 3) {
    return zapInAndZapOut(market, token, amount, minBack);
  }
  if (step == 4) {
    return mintRedeemSy(market, token, amount, minBack);
  }
  if (step == 5) {
    return mintRedeemPtAndYt(market, token, amount, minBack);
  }
  require(step == 6, "step is 1 to 6");
  return zeroPriceImpactZap(market, token, amount, minBack);
}
