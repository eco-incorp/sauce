// @chain ethereum
//
// Pays RECIPIENT, from the Pot, AMOUNT of USDC and AMOUNT of USDT.
//
// `USDC` and `USDT` are the chain's registered tokens, so there is no address to look up. Each
// `.transfer` is a SafeERC20 transfer: USDT, which returns nothing, works like any other token, and
// a token that answers `false` reverts the whole transaction. RECIPIENT and AMOUNT are defaults a
// define replaces: `--define RECIPIENT=0x… --define AMOUNT=1000000`.
const RECIPIENT = 0n;
const AMOUNT = 0n;

function main() {
  require(RECIPIENT != 0n);
  USDC.transfer(RECIPIENT, AMOUNT);
  USDT.transfer(RECIPIENT, AMOUNT);
}
