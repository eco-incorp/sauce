// Cancels a program the Pot's owner signed and no longer wants run: marks its salt used, so the
// signature never runs. Cooked by the owner, on the Pot the program was signed for. Like every
// owner cook that uses `Signed`, it also sets the Pot up to run signed programs, if it is not yet.
//
//   sauce run cancel-salt.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <salt>
//
//   salt: Uint256  the salt the program was signed under, `salt` as sauce sign printed it
//
// On Base:
//
//   sauce run cancel-salt.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <salt>
import { Signed } from "@sauce/signed";

function main(salt: Uint256): void {
  Signed.cancel(salt);
}
