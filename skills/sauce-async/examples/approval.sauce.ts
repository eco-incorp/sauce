// Pays `amount` of the chain's native coin to `recipient` once the Pot's owner approves, within a
// day: the payment waits as a promise raced against a day's timeout. The owner approves in a later
// cook, by the key this program returns (`Async.resolve(key, …)`); after the day, anyone may call
// the Pot's `expire` on the timeout, and the payment never happens. The Pot must be a Private Pot
// with @sauce/async's handlers installed (`sauce run @sauce/async --chain <chain>`).
//
//   sauce run approval.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <recipient> <amount>
//
//   recipient: Address  who is paid
//   amount: Uint256  how much of the native coin, in wei
//
// On Base, 0.01 ETH, paid once the owner approves:
//
//   sauce run approval.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <recipient> 10000000000000000
import { Async, Promise } from "@sauce/async";

function main(recipient: Address, amount: Uint256): Uint256 {
  const approval = Promise.withResolvers();
  Promise.race([approval.promise, Async.timeout(86400)])
    .then((value) => {
      evm.call(recipient, amount, hex``);
    })
    .catch((e) => {
      log(e);
    });
  return approval.key;
}
