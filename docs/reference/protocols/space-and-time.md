<!-- Generated from the SDK's registries. Do not edit. -->

# Space and Time (`space-and-time`)

ZK-proven SQL over indexed chain data: a contract asks the QueryRouter a query, pays in SXT, and Space and Time's fulfiller answers it with a Proof of SQL that the router verifies against table commitments Space and Time's validators sign, then calls the requester back with the result through the CallbackExecutor.

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `SpaceAndTime` on ethereum, base |
| Chains | ethereum, base |

## In a Sauce program

A Sauce program asks a query with `@sauce/zk` ([proofs](../../guides/async.md#proofs-saucezk)): `Zk.sql({ query, payment })`, its result
handed to the request's `.then`, the handler that checks the callback installed on the Pot.

## How a query works

1. **Off chain**, the SQL becomes a proof plan: Space and Time's RPC answers
   `commitments_v1_evmProofPlan` with `{ "query": "<SQL>" }` with the plan's bytes. The tables are
   Space and Time's: its indexed copies of chains (Ethereum, Base, …) and tables users create there.
2. **On chain**, `requestQuery(query, callback, payment)` returns the `queryId` and pulls
   `payment.paymentAmount` of SXT from the caller, who approves the QueryRouter first:
   - `query`: `{ version, innerQuery, parameters, metadata }`. `version` is `keccak256("latest")`,
     which the QueryRouter maps to its current Proof of SQL verifier; `innerQuery` is the plan;
     `parameters` the serialized parameters, the 8 bytes `0000000000000000` for none.
   - `callback`: `{ maxGasPrice, gasLimit, callbackContract, selector, callbackData }`.
   - `payment`: `{ paymentAmount, refundTo, timeout }`, `timeout` a unix time.
3. **The callback.** The fulfiller runs the query, proves it, and calls `fulfillQuery`; the
   QueryRouter verifies the proof and its CallbackExecutor calls `callbackContract` with
   `<selector>(bytes32 queryId, bytes result, bytes callbackData)`, with exactly `gasLimit` gas.
   `result` is the proven table, serialized: a `uint64` column count, then per column its name (a
   `uint64` length and the bytes), a zero byte, a `uint32` type (5 is BIGINT, 7 VARCHAR, 8
   DECIMAL75 with a precision and a scale byte after it), and its data (a `uint64` row count, then
   the values, BIGINT as 8-byte big-endian two's complement).

## Pitfalls

- **Authenticate the caller and the query.** `msg.sender` must be the CallbackExecutor, and the
  `queryId` one the receiver asked: anyone can ask a query naming any contract as its callback, and
  the requester is not passed. The `queryId` is `keccak256(abi.encode(chainid, router, nonce,
query, callback))`, unique per query the router takes, so a receiver keeps the ids it asked.
- **Use the `"latest"` version.** A `version` the router has no entry for is read as an address,
  and the router asks THAT contract to verify the proof — a verifier of anyone's choosing. Space
  and Time's own tutorial names a verifier address this way; name `keccak256("latest")` instead.
- **Fulfilment is permissioned.** Only an address holding the QueryRouter's `FULFILLER_ROLE`
  answers (`openFulfillment()` is false), so a query is answered when Space and Time's fulfiller
  chooses to. Not every query is: give each a `timeout` you can wait for, and plan for none.
- **Payment.** The fulfiller is paid the lesser of `paymentAmount` and `baseCost()` plus the
  callback's gas priced in SXT (Ethereum: `min(tx.gasprice, maxGasPrice)` through Chainlink's
  ETH/USD and SXT/USD feeds; Base charges no callback gas); the rest goes back to `refundTo`. A
  payment below `baseCost()` is all the fulfiller would get, which it may not take.
- **Refunds.** After `payment.timeout`, anyone may `cancelQuery(queryId, payment)` with the payment
  exactly as asked; it refunds `paymentAmount` to `refundTo`. A query fulfilled first cannot be
  cancelled (`QueryNotFound`).
- **A failed callback is not retried.** The executor catches a revert (`CallbackFailed`), the
  fulfiller is still paid, and the query is no longer pending.

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### baseCost

The least a query pays the fulfiller, in SXT's base units, before the callback's gas.

```typescript
import { QueryRouterABI as IQueryRouter } from "./abis";

function main(router: Address): Uint256 {
  return IQueryRouter.at(router).baseCost();
}
```

### pendingPayment

Whether a query is still pending: the hash of its payment while it is, zero once it is fulfilled or
cancelled.

```typescript
import { QueryRouterABI as IQueryRouter } from "./abis";

function main(router: Address, queryId: Uint256): Uint256 {
  return IQueryRouter.at(router).pendingPayments(queryId);
}
```

### cancelQuery

An unanswered query's payment back to its refundee, once its timeout has passed.

```typescript
import { QueryRouterABI as IQueryRouter } from "./abis";

function main(
  router: Address,
  queryId: Uint256,
  paymentAmount: Uint256,
  refundTo: Address,
  timeout: Uint256,
): void {
  IQueryRouter.at(router).cancelQuery(queryId, { paymentAmount, refundTo, timeout });
}
```

## Notes

- Sources: the QueryRouter's and CallbackExecutor's verified sources (Sourcify, both chains) and
  `spaceandtimefdn/sxt-chain-examples` (`tutorials/onchain_hello_world_query`), and
  `spaceandtimefdn/sxt-proof-of-sql` (`solidity/src/client/ParamsBuilder.presl`,
  `PoSQLTable.presl`) for the parameter and result encodings.
- SXT is the payment token the QueryRouter names (`PAYMENT_TOKEN()`); `baseCost()` was 1,000 SXT
  on Ethereum and 100 SXT on Base when this was written.
- The CallbackExecutor caps `gasLimit` at its `maxGasLimit()`, and sends no value.

## Its names in a program

On Ethereum, `SpaceAndTime` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's callbackExecutor, `0xaCf075862425A0c839844369ac20e334B3710e47`.
  require(SpaceAndTime.CallbackExecutor != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | callbackExecutor | `0xaCf075862425A0c839844369ac20e334B3710e47` | `SpaceAndTime.CallbackExecutor` |
| [Ethereum](../chains/ethereum.md) | queryRouter | `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` | `SpaceAndTime.QueryRouter` |
| [Base](../chains/base.md) | callbackExecutor | `0xaCf075862425A0c839844369ac20e334B3710e47` | `SpaceAndTime.CallbackExecutor` |
| [Base](../chains/base.md) | queryRouter | `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` | `SpaceAndTime.QueryRouter` |

## ABI

### `CallbackExecutorABI`

`import CallbackExecutorABI from "./protocols/space-and-time/CallbackExecutorABI.json";` Speaks for: callbackExecutor.

- `maxGasLimit() view returns (uint256)`
- `gasCostConfig() view returns (address nativeUsdFeed, uint64 nativeStaleThreshold, address tokenUsdFeed, uint64 tokenStaleThreshold, uint256 scalingFactor)`

### `QueryRouterABI`

`import QueryRouterABI from "./protocols/space-and-time/QueryRouterABI.json";` Speaks for: queryRouter.

- `requestQuery((bytes32 version, bytes innerQuery, bytes parameters, bytes metadata) query, (uint256 maxGasPrice, uint64 gasLimit, address callbackContract, bytes4 selector, bytes callbackData) callback, (uint256 paymentAmount, address refundTo, uint64 timeout) payment) returns (bytes32 queryId)`
- `cancelQuery(bytes32 queryId, (uint256 paymentAmount, address refundTo, uint64 timeout) payment)`
- `fulfillQuery((bytes32 version, bytes innerQuery, bytes parameters, bytes metadata) query, (uint256 maxGasPrice, uint64 gasLimit, address callbackContract, bytes4 selector, bytes callbackData) callback, (uint256 paymentAmount, address refundTo, uint64 timeout) payment, uint64 queryNonce, bytes proof)`
- `verifyQuery((bytes32 version, bytes innerQuery, bytes parameters, bytes metadata) query, bytes proof) view returns (bytes result)`
- `baseCost() view returns (uint256)`
- `PAYMENT_TOKEN() view returns (address)`
- `EXECUTOR() view returns (address)`
- `versions(bytes32 versionHash) view returns (address verifier)`
- `pendingPayments(bytes32 queryId) view returns (bytes32 paymentHash)`
- `openFulfillment() view returns (bool)`
