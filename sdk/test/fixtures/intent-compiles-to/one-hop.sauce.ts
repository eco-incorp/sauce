// One hop to Base, its body a transfer. Compiled for Ethereum by
// intent-compiles-to.e2e.test.ts, which writes `one-hop.folded.txt` beside it from a
// real cook, and by sizes/cook-gas.mts; sizes/bytes.mjs replays it.
function main(amount: Uint256, delivered: Uint256, beneficiary: Address, refundTo: Address) {
  Base.hop({
    send: { token: USDC, amount },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  }).then(() => {
    USDC.transfer(beneficiary, delivered);
  });
}
