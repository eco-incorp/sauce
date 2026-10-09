// A coin flip for a prize: Chainlink VRF draws one random word, and when it arrives the Pot pays the
// prize in USDC to `heads` on an even word and to `tails` on an odd one. The request is paid from
// the Pot's balance as this program runs, in the native coin; the Pot keeps the Kitchen's fee for
// the callback. A day without an answer lets anyone expire the request, and the prize stays put.
// The Pot must be a Private Pot with @sauce/random's handlers installed
// (`sauce run @sauce/random --chain <chain>`).
//
//   sauce run coin-flip.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <heads> <tails> <prize>
//
//   heads: Address  paid on an even word
//   tails: Address  paid on an odd word
//   prize: Uint256  USDC, in its smallest unit
//
// On Base, a prize of 5 USDC:
//
//   sauce run coin-flip.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <heads> <tails> 5000000
import { Random } from "@sauce/random";

function main(heads: Address, tails: Address, prize: Uint256) {
  Random.vrf({ words: 1 })
    .within(86400)
    .then((words) => {
      USDC.transfer(words[0] % 2 == 0 ? heads : tails, prize);
    })
    .catch((e) => {
      log(e);
    });
}
