// Two hops, Base then Optimism, the second opened in the first one's body. Compiled for Ethereum by
// intent-compiles-to.e2e.test.ts, which writes `two-hops.folded.txt` beside it from a
// real cook, and by sizes/cook-gas.mts; sizes/bytes.mjs replays it.
function main(amount: Uint256, delivered: Uint256, beneficiary: Address, refundTo: Address) {
  Base.hop({
    send: { token: USDC, amount },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  }).then(() => {
    Optimism.hop({
      send: { token: USDC, amount: delivered },
      receive: { token: USDC, amount: delivered - 1000 },
      refundee: refundTo,
    }).then(() => {
      USDC.transfer(beneficiary, delivered - 1000);
    });
  });
}
