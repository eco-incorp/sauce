/**
 * QueryRouter calls as SauceScript templates.
 *
 * These are the low-level form. A program does not normally write them: `@sauce/zk`'s
 * `Zk.sql({ … }).then((result) => { … })` approves and pays the query, asks it with the Pot as its
 * callback, and runs the body when the CallbackExecutor calls back (`std/zk/zk.evm.js`). They are
 * here because a registered protocol describes what its contract can be asked to do: what a query
 * costs at least, whether one is pending, and how an unanswered one's payment comes back.
 */

// The least a query pays the fulfiller, in SXT's base units, before the callback's gas.
export const baseCost = `
import { QueryRouterABI as IQueryRouter } from "./abis";

function main(router: Address): Uint256 {
  return IQueryRouter.at(router).baseCost();
}
`;

// Whether the query is still pending: the hash of its payment while it is, zero once it is
// fulfilled or cancelled.
export const pendingPayment = `
import { QueryRouterABI as IQueryRouter } from "./abis";

function main(router: Address, queryId: Uint256): Uint256 {
  return IQueryRouter.at(router).pendingPayments(queryId);
}
`;

// An unanswered query's payment back to its refundee, once its timeout has passed. Anyone may cancel
// it; the payment is the one the query was asked with, as its `QueryRequested` event logs it.
export const cancelQuery = `
import { QueryRouterABI as IQueryRouter } from "./abis";

function main(router: Address, queryId: Uint256, paymentAmount: Uint256, refundTo: Address, timeout: Uint256): void {
  IQueryRouter.at(router).cancelQuery(queryId, { paymentAmount, refundTo, timeout });
}
`;
