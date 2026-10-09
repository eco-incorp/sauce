// A draw among three entrants with Pyth Entropy, raced against an hour: when the random number
// arrives within the hour, the Pot pays `prize` of the chain's native coin to the entrant it picks;
// after the hour, anyone may expire the timeout, and the draw is called off. The request is paid
// from the Pot's balance as this program runs; the Pot keeps the Kitchen's fee for the callback.
// The Pot must be a Private Pot with @sauce/random's handlers installed
// (`sauce run @sauce/random --chain <chain>`).
//
//   sauce run draw.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <first> <second> <third> <prize>
//
//   first: Address  an entrant
//   second: Address  an entrant
//   third: Address  an entrant
//   prize: Uint256  how much of the native coin, in wei
//
// On Base, 0.01 ETH to the winner:
//
//   sauce run draw.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <first> <second> <third> 10000000000000000
import { Async, Promise } from "@sauce/async";
import { Random } from "@sauce/random";

function main(first: Address, second: Address, third: Address, prize: Uint256) {
  Promise.race([Random.entropy(), Async.timeout(3600)])
    .then((value) => {
      const pick = value % 3;
      const winner = pick == 0 ? first : pick == 1 ? second : third;
      evm.call(winner, prize, hex``);
    })
    .catch((e) => {
      log(e);
    });
}
