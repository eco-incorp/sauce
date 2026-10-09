// Pays `amount` of Base's native coin to `recipient` from this Pot on Base, from a program cooked
// on Ethereum, and records back on Ethereum what the Pot holds on Base afterwards, in its storage at
// keccak256("base.balance"). The body runs on Base as this same Pot, when Hyperlane delivers it;
// the `.then` runs on Ethereum when the answer comes back. Both Pots answer the bridge once
// `sauce run @sauce/remote` installed their handlers, and hold the native coin each leg pays.
//
//   sauce run pay-on-base.sauce.ts --chain <chain> --wallet <name> --args <recipient> <amount>
//
//   recipient: Address   who is paid on Base
//   amount: Uint256      how much of Base's native coin, in wei
//
// From Ethereum, 0.001 ETH on Base:
//
//   sauce run pay-on-base.sauce.ts --chain ethereum --wallet <name> \
//     --args <recipient> 1000000000000000
function main(recipient: Address, amount: Uint256) {
  require(recipient != 0, "give the recipient");
  Base.remote(() => {
    require(ctx.selfBalance() >= amount, "not enough on Base yet");
    evm.call(recipient, amount, hex``);
    return ctx.selfBalance();
  }).then((result) => {
    const [left] = abi.decode(result, ["Uint256"]);
    evm.sstore(crypto.keccak256("base.balance"), left);
  });
}
