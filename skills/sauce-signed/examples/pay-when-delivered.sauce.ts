// What a Pot's owner signs for anyone to run on the Pot, once: pays `amount` of USDC to
// `recipient`, but only once the Pot holds it. Anyone may submit a signed program as soon as it is
// signed, so it checks what it needs itself: submitted before the USDC arrives, it reverts, and its
// salt stays unused for the submission that comes after it.
//
//   sauce sign pay-when-delivered.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --within 3600 --args <recipient> <amount>
//
//   recipient: Address  who is paid
//   amount: Uint256  how much USDC, in its base units (6 decimals)
//
// On Base, 25 USDC within the hour, for a relayer or a hop to submit:
//
//   sauce sign pay-when-delivered.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --within 3600 --args <recipient> 25000000
function main(recipient: Address, amount: Uint256): void {
  require(USDC.balanceOf(ctx.self()) >= amount, "not delivered yet");
  USDC.transfer(recipient, amount);
}
