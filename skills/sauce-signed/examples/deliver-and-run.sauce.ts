// Pays `amount` of USDC into another Pot and runs the program that Pot's owner signed there, in one
// transaction: the call the owner's signature lets anyone make. If the signed program refuses, or
// the signature is not the owner's, the payment is undone with it.
//
//   sauce run deliver-and-run.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <pot> <amount> <program> <salt> <deadline> <signature>
//
//   pot: Address  the owner's Pot, with @sauce/signed installed
//   amount: Uint256  how much USDC, in its base units (6 decimals)
//   program: bytes  the signed program, `program` as sauce sign printed it
//   salt: Uint256  its `salt`
//   deadline: Uint256  its `deadline`, in unix seconds
//   signature: bytes  its `signature`
//
// On Base, 25 USDC into the owner's Pot, then its signed payout:
//
//   sauce run deliver-and-run.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <pot> 25000000 <program> <salt> <deadline> <signature>
import { submit } from "@sauce/signed";

function main(
  pot: Address,
  amount: Uint256,
  program: bytes,
  salt: Uint256,
  deadline: Uint256,
  signature: bytes,
): void {
  USDC.transfer(pot, amount);
  submit(pot, program, salt, deadline, signature);
}
