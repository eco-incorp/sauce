// @sauce/swap — SVM arm. Swaps whose route a service builds when the program compiles, on Solana.
//
// A program writes `jupiterSwap(tokenIn, tokenOut, amountIn, minOut)` or `ecoSwap(...)`, with no
// import: the SDK hands every compile this module as an ambient one. Each is an arrow function the
// compiler runs at its call, which reads its route with `globalIn(scope, name)` from the module the
// SDK writes for that scope while the program compiles (`routes/swap-host.ts`): one instruction,
// Jupiter's aggregator's or eco-swap's merge program's, built for the Pot.
//
// The instruction's accounts are not in the route: they ride after the program's own, as the
// accounts it reads past its named ones (`svm.remainingAccounts()`), in the order the instruction
// takes them, and the cook carries them, with the lookup tables the route needs. So the route's
// accounts are ALL of those accounts, and a program makes ONE such swap.
//
// Each CPIs the instruction, the Pot signing as its authority through the Kitchen, and returns the
// amount of `tokenOut` that reached the Pot's token account for it, measured as the change in its
// balance, reverting below `minOut`. The output stays in the Pot. Neither reads or pays out the
// Pot's whole balance.
import { balanceOf } from "@sauce/token";

// Jupiter's aggregator: its `route` or `shared_accounts_route` instruction, its data cut where its
// quoted output sits. The program's `minOut` goes there, at no slippage, so the aggregator refuses a
// short fill before the program does. The route fixes the amount it swaps. A `minOut` past a u64 is
// cut to its low 8 bytes there, and refused here: the output, a u64, never reaches it.
export const jupiterSwap = (tokenIn, tokenOut, amountIn, minOut) => {
  const route = { swap: "jupiter", chainId, body: __sauce_body, tokenIn, tokenOut, amountIn };
  const callee = globalIn(route, "__sauce_swap_callee");
  const output = globalIn(route, "__sauce_swap_output");
  const head = globalIn(route, "__sauce_swap_head");
  const tail = globalIn(route, "__sauce_swap_tail");
  const accounts = svm.remainingAccounts();
  const target = svm.remainingAccount(output);
  const before = balanceOf(tokenOut, target);
  svm.call(svm.remainingAccount(callee), accounts, head.concat(minOut.toBytesLe(8)).concat(tail));
  const out = balanceOf(tokenOut, target) - before;
  require(out >= minOut, "jupiterSwap: below minOut");
  return out;
};

// eco-swap's merge program: one instruction, the program's amount and floor written into its data
// where eco-swap's contract says. It is a route for any amount, so the amount may be one the
// program computes.
export const ecoSwap = (tokenIn, tokenOut, amountIn, minOut) => {
  const route = { swap: "eco", chainId, body: __sauce_body, tokenIn, tokenOut };
  const callee = globalIn(route, "__sauce_swap_callee");
  const output = globalIn(route, "__sauce_swap_output");
  const head = globalIn(route, "__sauce_swap_head");
  const middle = globalIn(route, "__sauce_swap_middle");
  const tail = globalIn(route, "__sauce_swap_tail");
  // A token amount on Solana is a u64: a larger one would be cut to its low 8 bytes. A floor past
  // one is no risk: the output, a u64, never reaches it, so the swap reverts below.
  require(amountIn < 18446744073709551616, "ecoSwap: amountIn past a u64");
  const amount = amountIn.toBytesLe(8);
  const floor = minOut.toBytesLe(8);
  const data = globalIn(route, "__sauce_swap_amount_first")
    ? head.concat(amount).concat(middle).concat(floor).concat(tail)
    : head.concat(floor).concat(middle).concat(amount).concat(tail);
  const accounts = svm.remainingAccounts();
  const target = svm.remainingAccount(output);
  const before = balanceOf(tokenOut, target);
  svm.call(svm.remainingAccount(callee), accounts, data);
  const out = balanceOf(tokenOut, target) - before;
  require(out >= minOut, "ecoSwap: below minOut");
  return out;
};

// KyberSwap routes on EVM chains; a program for Solana swaps through the other two.
export const kyberSwap = () => {
  throw new Error("kyberSwap swaps on EVM chains; on Solana, jupiterSwap or ecoSwap");
};
