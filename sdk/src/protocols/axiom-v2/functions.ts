/**
 * AxiomV2Query calls as SauceScript templates.
 *
 * These are the low-level form. A program does not normally write them: `@sauce/zk`'s
 * `Zk.axiom({ … }).then((results) => { … })` sends the query with its fee and its continuation, and
 * the Pot's handler runs the continuation when AxiomV2Query calls back (`std/zk/zk.evm.js`). They
 * are here because a registered protocol describes what its contract can be asked to do: what a
 * query escrows, where a query stands, and how an unfulfilled one's escrow comes back.
 */

// What `sendQuery` escrows for a query, in wei: the callback's gas and the proof's verification at
// `maxFeePerGas`, and Axiom's fee (`overrideAxiomQueryFee` when it is the larger).
export const queryPrice = `
import { AxiomV2QueryABI as IAxiomV2Query } from "./abis";

function main(query: Address, maxFeePerGas: Uint256, callbackGasLimit: Uint256, overrideAxiomQueryFee: Uint256): Uint256 {
  const axiom = IAxiomV2Query.at(query);
  const fee = axiom.axiomQueryFee();
  const queryFee = overrideAxiomQueryFee > fee ? overrideAxiomQueryFee : fee;
  return maxFeePerGas * (callbackGasLimit + axiom.proofVerificationGas()) + queryFee;
}
`;

// A query's state: 0 inactive (never sent, or refunded), 1 active, 2 fulfilled, 3 paid.
export const queryState = `
import { AxiomV2QueryABI as IAxiomV2Query } from "./abis";

function main(query: Address, queryId: Uint256): Uint256 {
  const metadata = IAxiomV2Query.at(query).queries(queryId);
  return metadata.state;
}
`;

// An unfulfilled query's escrow, back to its refundee once its deadline block has passed: the
// refund credits the refundee's balance at AxiomV2Query, and the withdrawal pays it out. Run by the
// refundee — the Pot that sent the query, unless it named another. The witness is the query's
// `QueryInitiatedOnchain` event: its caller, salt, query hash and refundee, and
// `keccak256(target ++ extraData)` of its callback.
export const refundQuery = `
import { AxiomV2QueryABI as IAxiomV2Query } from "./abis";

function main(
  query: Address,
  caller: Address,
  userSalt: Uint256,
  queryHash: Uint256,
  callbackHash: Uint256,
  refundee: Address,
  payee: Address,
): Uint256 {
  const axiom = IAxiomV2Query.at(query);
  axiom.refundQuery({ caller, userSalt, queryHash, callbackHash, refundee });
  const amount = axiom.balances(refundee);
  axiom.withdraw(amount, payee);
  return amount;
}
`;
