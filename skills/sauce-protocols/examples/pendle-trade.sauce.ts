// Buys or sells a Pendle market's PT or YT for the token its SY is minted from, through Pendle's
// Router, with no aggregator and no limit orders: the token becomes SY, and the market's pool trades
// it. Buying spends exactly `amount` of `token` and takes at least `minOut` PT or YT; selling spends
// exactly `amount` of the Pot's PT or YT and takes at least `minOut` of `token`. The market names its
// own SY, PT and YT (readTokens), so the program takes only the market. The Router is approved for
// exactly `amount` and must take all of it, and what `recipient` received is measured as a balance
// change. The market's reads and the Router's sells are not in the registry's Pendle ABI:
// PendleMarket.json and PendleRouterTrades.json beside this file declare them. Returns what the Pot
// spent and what the recipient received.
//
//   sauce run pendle-trade.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <market> <token> <useYt> <sell> <amount> <minOut> <recipient>
//
//   market: Address     the Pendle market, one per underlying and expiry
//   token: Address      the token the market's SY mints from and redeems to, such as wstETH for a
//                       wstETH market
//   useYt: bool         false trades the market's PT, true its YT
//   sell: bool          false buys PT or YT with `token`; true sells the Pot's PT or YT for `token`
//   amount: Uint256     what the Pot spends: `token` when buying, PT or YT when selling, in its
//                       smallest units (18 decimals): 1000000000000000000 is 1 wstETH
//   minOut: Uint256     the least the recipient must receive: PT or YT when buying, `token` when
//                       selling, in the same units
//   recipient: Address  who receives what is bought: the user, or the Pot's own address to keep it
//                       there for a later sale
//
// On Ethereum, 1 wstETH spent on the PT of a wstETH market, for at least 1 PT:
//
//   sauce run pendle-trade.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <market> 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0 false false \
//     1000000000000000000 1000000000000000000 <recipient>
import PendleMarket from "./PendleMarket.json";
import PendleRouterTrades from "./PendleRouterTrades.json";

// One limit-order fill, as the Router's LimitOrderData lists them. This program fills none.
interface Order {
  salt: Uint256;
  expiry: Uint256;
  nonce: Uint256;
  orderType: Uint256;
  token: Address;
  YT: Address;
  maker: Address;
  receiver: Address;
  makingAmount: Uint256;
  lnImpliedRate: Uint256;
  failSafeRate: Uint256;
  permit: bytes;
}
interface Fill {
  order: Order;
  signature: bytes;
  makingAmount: Uint256;
}

function main(
  market: Address,
  token: Address,
  useYt: bool,
  sell: bool,
  amount: Uint256,
  minOut: Uint256,
  recipient: Address,
): { spent: Uint256; received: Uint256 } {
  const [, pt, yt] = PendleMarket.at(market).readTokens();
  let traded = pt;
  if (useYt) traded = yt;
  let tokenIn = token;
  let tokenOut = traded;
  if (sell) {
    tokenIn = traded;
    tokenOut = token;
  }

  const inBefore = Token(tokenIn).balanceOf(pot);
  require(inBefore >= amount, "the Pot does not hold amount");
  const outBefore = Token(tokenOut).balanceOf(recipient);

  // No external swap: `token` is one the SY takes, so it mints and redeems the SY itself.
  const noSwap = { swapType: 0, extRouter: 0, extCalldata: hex``, needScale: false };
  const noFills: Fill[] = [];
  const noLimitOrders = {
    limitRouter: 0,
    epsSkipMarket: 0,
    normalFills: noFills,
    flashFills: noFills,
    optData: hex``,
  };

  Token(tokenIn).approve(Pendle.Router, amount);
  if (sell) {
    const output = {
      tokenOut: token,
      minTokenOut: minOut,
      tokenRedeemSy: token,
      pendleSwap: 0,
      swapData: noSwap,
    };
    if (useYt) {
      PendleRouterTrades.at(Pendle.Router).swapExactYtForToken(
        recipient,
        market,
        amount,
        output,
        noLimitOrders,
      );
    } else {
      PendleRouterTrades.at(Pendle.Router).swapExactPtForToken(
        recipient,
        market,
        amount,
        output,
        noLimitOrders,
      );
    }
  } else {
    const input = {
      tokenIn: token,
      netTokenIn: amount,
      tokenMintSy: token,
      pendleSwap: 0,
      swapData: noSwap,
    };
    // The pool prices by exact PT or YT, so the Router searches for what `amount` buys: on chain,
    // over the whole range, to within 0.01%.
    const search = {
      guessMin: 0,
      guessMax: ~0,
      guessOffchain: 0,
      maxIteration: 256,
      eps: 100000000000000,
    };
    if (useYt) {
      Pendle.Router.swapExactTokenForYt(recipient, market, minOut, search, input, noLimitOrders);
    } else {
      Pendle.Router.swapExactTokenForPt(recipient, market, minOut, search, input, noLimitOrders);
    }
  }

  const spent = inBefore - Token(tokenIn).balanceOf(pot);
  require(spent == amount, "the Router did not take exactly amount");
  const received = Token(tokenOut).balanceOf(recipient) - outBefore;
  require(received >= minOut, "received less than minOut");
  return { spent, received };
}
