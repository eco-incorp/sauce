// Cancels a program the Pot's owner signed and no longer wants run: marks its salt used, so the
// signature never runs. Cooked by the owner, on the Pot the program was signed for.
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
import { cancel } from "@sauce/signed";

function main(salt: Uint256): void {
  cancel(salt);
}
