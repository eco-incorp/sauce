// @sauce/swap — SVM arm. Swaps whose route a service builds when the program compiles, on Solana.
//
// A program writes `jupiterSwap(tokenIn, tokenOut, amountIn, minOut)` or `ecoSwap(...)`. Those names
// are the SDK's host's (`routes/swap-host.ts`): it asks the service for a route while the program
// compiles — one instruction, Jupiter's aggregator's or eco-swap's merge program's, built for the
// Pot — and lowers each call to one of these functions, with the instruction's data as an argument.
// The instruction's accounts are not arguments: they ride after the program's own, as the
// accounts it reads past its named ones (`svm.remainingAccounts()`), in the order the instruction
// takes them, and the cook carries them, with the lookup tables the route needs.
//
// So the route's accounts are ALL of those accounts, and a program makes ONE such swap: an account
// list cannot yet be cut out of them by a count the program computes.
//
// `program` and `output` are positions among those accounts: the program the instruction calls,
// and the Pot's token account for `tokenOut`. Each function CPIs the instruction, the Pot signing as
// its authority through the Kitchen, and returns the amount of `tokenOut` that reached that account,
// measured as the change in its balance, reverting below `minOut` (32 bytes, big-endian). The
// output stays in the Pot. Neither reads or pays out the Pot's whole balance.
import { balanceOf } from "@sauce/token";

// Jupiter's aggregator: its `route` or `shared_accounts_route` instruction, whose own floor the SDK
// set to `minOut` (its quoted output, at no slippage).
export function jupiter(
  program: Uint256,
  output: Uint256,
  tokenOut: Address,
  data: bytes,
  minOut: bytes,
): Uint256 {
  const route = svm.remainingAccounts();
  const target = svm.remainingAccount(output);
  const before = balanceOf(tokenOut, target);
  svm.call(svm.remainingAccount(program), route, data);
  const out = balanceOf(tokenOut, target) - before;
  require(out >= minOut.toBe(), "below minOut");
  return out;
}

// eco-swap's merge program: one instruction, its amount and floor written into its data.
export function eco(
  program: Uint256,
  output: Uint256,
  tokenOut: Address,
  data: bytes,
  minOut: bytes,
): Uint256 {
  const route = svm.remainingAccounts();
  const target = svm.remainingAccount(output);
  const before = balanceOf(tokenOut, target);
  svm.call(svm.remainingAccount(program), route, data);
  const out = balanceOf(tokenOut, target) - before;
  require(out >= minOut.toBe(), "below minOut");
  return out;
}
