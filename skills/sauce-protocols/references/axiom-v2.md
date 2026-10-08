# Axiom V2

ZK coprocessor over a chain's history: a query reads block headers, accounts, storage, transactions and receipts, a compute circuit proves a result over them, and AxiomV2Query calls the requester back with the proven results. Axiom ended support for V2 on December 21, 2024: the contracts remain deployed and unfrozen, but no prover has fulfilled a query since.

## Category

infrastructure (ZK coprocessor) | Chains and addresses: [registry/axiom-v2.md](registry/axiom-v2.md)

## Status: no prover fulfils a query

Axiom shifted to OpenVM and ended support for Axiom V2 on December 21, 2024. AxiomV2Query is still
deployed on Ethereum and Base, unfrozen, and still takes a query and its fee — but the last query
fulfilled on Ethereum was on September 22, 2024 and on Base on April 28, 2024, queries sent since are
still open, and the block-hash accumulators a proof is checked against stopped moving at the end of
2024, so no proof over a recent block can verify. A query sent now escrows its fee until its deadline
block passes, when only its refundee can take the fee back (`refundQuery`, then `withdraw`). Do not
send one expecting a callback.

## How a query works

1. **Off chain**, Axiom's tooling (`@axiom-crypto/client`, `npx axiom circuit compile` then `prove`)
   turns a circuit and its inputs into the query's arguments: `dataQueryHash` and the raw
   `dataQuery` (the subqueries: headers, accounts, storage slots, transactions, receipts, mapping
   entries), and `computeQuery` (`k`, the circuit's degree; `resultLen`, how many results it
   outputs; `vkey`, its verifying key; `computeProof`, the proof of the compute step over its
   inputs). `k: 0` is a data-only query, whose results are the subqueries' own.
2. **On chain**, `sendQuery(sourceChainId, dataQueryHash, computeQuery, callback, feeData, userSalt,
refundee, dataQuery)` with exactly `maxFeePerGas * (callbackGasLimit + proofVerificationGas()) +
axiomQueryFee()` in wei escrows the fee and returns the `queryId`. Any other value is credited to
   the sender's balance at AxiomV2Query and the price taken from that balance, reverting
   `EscrowAmountExceedsBalance` when it falls short.
3. **The callback.** A prover fulfils it with a proof, and AxiomV2Query calls `callback.target` with
   `axiomV2Callback(uint64 sourceChainId, address caller, bytes32 querySchema, uint256 queryId,
bytes32[] axiomResults, bytes extraData)` (selector `0xdc5cd53c`), with exactly `callbackGasLimit`
   gas and no value.

## Pitfalls

- **Authenticate both callers.** `msg.sender` must be AxiomV2Query, and `caller` — who sent the
  query — must be the receiver itself: anyone can send a query whose callback names any target.
  `extraData` is then the receiver's own: the `queryId` commits to `keccak256(target ++ extraData)`,
  and a fulfilment must present both.
- **A failed callback is not retried.** AxiomV2Query marks the query fulfilled first, then calls
  back; a callback that reverts or runs out of `callbackGasLimit` emits
  `QueryFulfilled(queryId, payee, false)` and the results are gone. Budget the gas for the whole
  callback.
- **The source chain is the deployment's.** Each AxiomV2Query proves one chain's history
  (`getSourceChainId()` of its header verifier): Ethereum's reads Ethereum, Base's reads Base.
  `sendQuery` reverts `SourceChainIdDoesNotMatch` for any other.
- **`querySchema`** is `keccak256(k . resultLen . vkeyLen . vkey)`, a circuit's identity, reported
  in the callback; `sendQuery` does not take it. The `queryId` already binds the query to its
  circuit, so a receiver that sent the query need not check it.
- **The `dataQuery` bytes are not checked** against `dataQueryHash` on chain; they are there for the
  prover. Pass the ones Axiom's tooling produced with the hash.
- **A query id is unique per sender, salt, query and callback.** Sending the same query with the
  same `userSalt`, callback and refundee twice reverts `QueryIsNotInactive`.
- **Refunds.** After `deadlineBlockNumber` (`queryDeadlineInterval()` blocks after sending: 7,200 on
  Ethereum, 43,200 on Base) only the refundee may call `refundQuery(witness)`, which credits its
  balance at AxiomV2Query; `withdraw(amount, payee)` pays it out. A zero `refundee` is the sender.
- `minMaxFeePerGas()` is the lowest `maxFeePerGas` a query may name (5 gwei on Ethereum, 0.01 gwei
  on Base); below it `sendQuery` reverts `MaxFeePerGasIsTooLow`.

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### queryPrice

What `sendQuery` escrows for a query, in wei.

```typescript
import { AxiomV2QueryABI as IAxiomV2Query } from "./abis";

function main(
  query: Address,
  maxFeePerGas: Uint256,
  callbackGasLimit: Uint256,
  overrideAxiomQueryFee: Uint256,
): Uint256 {
  const axiom = IAxiomV2Query.at(query);
  const fee = axiom.axiomQueryFee();
  const queryFee = overrideAxiomQueryFee > fee ? overrideAxiomQueryFee : fee;
  return maxFeePerGas * (callbackGasLimit + axiom.proofVerificationGas()) + queryFee;
}
```

### queryState

A query's state: 0 inactive (never sent, or refunded), 1 active, 2 fulfilled, 3 paid.

```typescript
import { AxiomV2QueryABI as IAxiomV2Query } from "./abis";

function main(query: Address, queryId: Uint256): Uint256 {
  const metadata = IAxiomV2Query.at(query).queries(queryId);
  return metadata.state;
}
```

### refundQuery

An unfulfilled query's escrow back to its refundee once its deadline block has passed. The witness
is the query's `QueryInitiatedOnchain` event: its caller, salt, query hash and refundee, and
`keccak256(target ++ extraData)` of its callback.

```typescript
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
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/axiom-v2.md](registry/axiom-v2.md).

## Notes

- Sources: `axiom-crypto/axiom-v2-contracts` (`contracts/query/AxiomV2Query.sol`,
  `contracts/interfaces/client/IAxiomV2Client.sol`) and `axiom-crypto/axiom-v2-periphery`
  (`src/client/AxiomV2Client.sol`), both archived; the end of support is in `axiom-crypto/axiom-docs`'
  introduction.
- The fee is in wei, though the contracts' comments say gwei: `axiomQueryFee()` is 0.003 ETH on both
  chains, `proofVerificationGas()` 420,000.
- `sendQueryWithIpfsData` takes a query hash and an IPFS hash of the query instead of its parts,
  and skips the source-chain check.
- An off-chain query's callback is `axiomV2OffchainCallback` (same arguments, selector `0x8193399c`),
  whose `caller` is the prover that fulfilled it.
