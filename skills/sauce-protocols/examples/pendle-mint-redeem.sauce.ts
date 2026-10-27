// Mints a Pendle market's SY, or its PT and YT together, from the token its SY takes, or redeems them
// back to that token, through Pendle's Router with no aggregator. None of it trades in the market's
// pool: the SY wraps the token, and the YT contract splits SY into equal PT and YT, or joins them
// back before the market expires. Minting spends exactly `amount` of `token` and gives at least
// `minOut` SY, or at least `minOut` each of PT and YT; redeeming spends exactly `amount` of SY, or
// `amount` each of PT and YT, and gives at least `minOut` of `token`. The Router is approved for
// exactly what it takes and must take all of it. The market's reads and these Router functions are
// not in the registry's Pendle ABI: PendleMarket.json and PendleRouterTrades.json beside this file
// declare them. Returns what the Pot spent and what the recipient received, as balance changes.
//
//   sauce run pendle-mint-redeem.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <market> <token> <split> <redeem> <amount> <minOut> <recipient>
//
//   market: Address     the Pendle market whose SY, PT and YT these are
//   token: Address      the token the SY mints from and redeems to, such as wstETH for a wstETH
//                       market
//   split: bool         false mints or redeems SY; true mints or redeems PT and YT together
//   redeem: bool        false mints from `token`; true redeems the Pot's SY, or PT and YT, to it
//   amount: Uint256     what the Pot spends: `token` when minting; SY, or PT and YT each, when
//                       redeeming; in its smallest units (18 decimals): 1000000000000000000 is 1
//   minOut: Uint256     the least the recipient must receive: SY, or PT and YT each, when minting;
//                       `token` when redeeming; in the same units
//   recipient: Address  who receives what is minted or redeemed: the user, or the Pot's own
//                       address to keep it there
//
// On Ethereum, 1 wstETH split into a wstETH market's PT and YT, at least 1 of each:
//
//   sauce run pendle-mint-redeem.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <market> 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0 true false \
//     1000000000000000000 1000000000000000000 <recipient>
import PendleMarket from "./PendleMarket.json";
import PendleRouterTrades from "./PendleRouterTrades.json";

function main(
  market: Address,
  token: Address,
  split: bool,
  redeem: bool,
  amount: Uint256,
  minOut: Uint256,
  recipient: Address,
): { spent: Uint256; received: Uint256 } {
  const [sy, pt, yt] = PendleMarket.at(market).readTokens();
  const router = PendleRouterTrades.at(Pendle.Router);
  const noSwap = { swapType: 0, extRouter: 0, extCalldata: hex``, needScale: false };

  let spent: Uint256 = 0;
  let received: Uint256 = 0;
  if (redeem) {
    const output = {
      tokenOut: token,
      minTokenOut: minOut,
      tokenRedeemSy: token,
      pendleSwap: 0,
      swapData: noSwap,
    };
    const outBefore = Token(token).balanceOf(recipient);
    if (split) {
      // PT and YT are redeemed in pairs: `amount` of each.
      const ptBefore = Token(pt).balanceOf(pot);
      const ytBefore = Token(yt).balanceOf(pot);
      require(ptBefore >= amount &&
        ytBefore >= amount, "the Pot does not hold amount of PT and YT");
      Token(pt).approve(Pendle.Router, amount);
      Token(yt).approve(Pendle.Router, amount);
      router.redeemPyToToken(recipient, yt, amount, output);
      spent = ptBefore - Token(pt).balanceOf(pot);
      require(ytBefore - Token(yt).balanceOf(pot) == spent, "PT and YT were not redeemed in pairs");
    } else {
      const syBefore = Token(sy).balanceOf(pot);
      require(syBefore >= amount, "the Pot does not hold amount of SY");
      Token(sy).approve(Pendle.Router, amount);
      router.redeemSyToToken(recipient, sy, amount, output);
      spent = syBefore - Token(sy).balanceOf(pot);
    }
    received = Token(token).balanceOf(recipient) - outBefore;
  } else {
    const input = {
      tokenIn: token,
      netTokenIn: amount,
      tokenMintSy: token,
      pendleSwap: 0,
      swapData: noSwap,
    };
    const inBefore = Token(token).balanceOf(pot);
    require(inBefore >= amount, "the Pot does not hold amount");
    Token(token).approve(Pendle.Router, amount);
    if (split) {
      const ptBefore = Token(pt).balanceOf(recipient);
      const ytBefore = Token(yt).balanceOf(recipient);
      router.mintPyFromToken(recipient, yt, minOut, input);
      received = Token(pt).balanceOf(recipient) - ptBefore;
      require(Token(yt).balanceOf(recipient) - ytBefore == received, "PT and YT differ");
    } else {
      const syBefore = Token(sy).balanceOf(recipient);
      router.mintSyFromToken(recipient, sy, minOut, input);
      received = Token(sy).balanceOf(recipient) - syBefore;
    }
    spent = inBefore - Token(token).balanceOf(pot);
  }

  require(spent == amount, "the Router did not take exactly amount");
  require(received >= minOut, "received less than minOut");
  return { spent, received };
}
