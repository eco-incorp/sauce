/**
 * BoundlessMarket calls as SauceScript templates.
 *
 * These are the low-level form. A program does not normally write them: `@sauce/zk`'s
 * `Zk.risc0({ … }).then((journal) => { … })` builds the request, deposits its price, submits it with
 * the Pot as its callback and approves it as the Pot's own, and runs the body when the market calls
 * back (`std/zk/zk.evm.js`). They are here because a registered protocol describes what its contract
 * can be asked to do: what a requestor holds at the market, where a request stands, and how an
 * expired one's price comes back.
 */

// What `holder` holds at the market, in wei: deposits not yet spent on a locked request.
export const balance = `
import { BoundlessMarketABI as IBoundlessMarket } from "./abis";

function main(market: Address, holder: Address): Uint256 {
  return IBoundlessMarket.at(market).balanceOf(holder);
}
`;

// A request's state: 1 locked, 2 fulfilled (fulfilment wins), 0 neither.
export const requestState = `
import { BoundlessMarketABI as IBoundlessMarket } from "./abis";

function main(market: Address, requestId: Uint256): Uint256 {
  const boundless = IBoundlessMarket.at(market);
  if (boundless.requestIsFulfilled(requestId)) {
    return 2;
  }
  return boundless.requestIsLocked(requestId) ? 1 : 0;
}
`;

// A locked request past its deadline and unfulfilled: slash its prover, which refunds the price to
// the requestor's balance at the market, and withdraw `amount` of that balance to the caller. Anyone
// may slash; only the requestor withdraws its own balance.
export const slashAndWithdraw = `
import { BoundlessMarketABI as IBoundlessMarket } from "./abis";

function main(market: Address, requestId: Uint256, amount: Uint256): void {
  const boundless = IBoundlessMarket.at(market);
  boundless.slash(requestId);
  boundless.withdraw(amount);
}
`;
