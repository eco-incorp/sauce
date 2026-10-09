---
name: sauce-zk
description: Proven answers in a Sauce program with @sauce/zk — asked now, answered later by a callback that runs the request's .then body on the same Private Pot — a SQL query over indexed chain data proven with Space and Time's Proof of SQL (Zk.sql, Ethereum and Base), or a RISC Zero guest program proven run on an input by Boundless's market (Zk.risc0, Base). Covers each request's fields and payment (SXT, or ETH and a proving node's ZKC collateral), reading a proven SQL table (Zk.cell, Zk.rows), the journal a guest must commit, how the Pot signs its own Boundless requests, timeouts and taking an unanswered request's payment back (Zk.cancel, Zk.reclaim), installing the handlers (sauce run @sauce/zk), what each handler checks and why only the Pot's own requests settle, and what each costs. Use when a program must act on chain history or a computation it cannot run itself, proven rather than reported, or when the user mentions ZK, a coprocessor, Proof of SQL, Space and Time, SXT, RISC Zero, Boundless or a zkVM.
---

# Proven answers with `@sauce/zk`

Some answers a program cannot work out itself: what an account held a month ago, how many times an
event fired, a sum over a table, or a computation too large to run on chain. A ZK coprocessor works
it out off chain and proves it, and a contract checks the proof before it calls the asker back.
`@sauce/zk` makes the request a promise of `@sauce/async`'s (`sauce-async`): the program asks now,
and its `.then` body runs on the same Private Pot when the proven answer arrives. It speaks two:

| Coprocessor    | Asks                                                    | Pays                            | Chains         |
| -------------- | ------------------------------------------------------- | ------------------------------- | -------------- |
| Space and Time | `Zk.sql`: a SQL query over its indexed copies of chains | SXT                             | Ethereum, Base |
| Boundless      | `Zk.risc0`: a RISC Zero guest program, run on an input  | ETH; the proving node locks ZKC | Base           |

Space and Time answers questions about chains' history in SQL, and only its own fulfiller answers.
Boundless proves any program written for RISC Zero's zkVM, and any proving node may answer, bidding for
the price.

```sauce chain=base,ethereum
import { Zk } from "@sauce/zk";

function main(plan: bytes, payment: Uint256, minimum: Uint256, recipient: Address, amount: Uint256) {
  Zk.sql({ query: plan, payment })
    .then((result) => {
      require(Zk.cell(result, 0, 0) >= minimum, "below the minimum");
      evm.call(recipient, amount, hex``);
    })
    .catch((e) => {
      Zk.cancel(e);
    });
}
```

[`examples/proven-payout.sauce.ts`](examples/proven-payout.sauce.ts) is this program, and
[`examples/proven-guest.sauce.ts`](examples/proven-guest.sauce.ts) pays once a Boundless guest's
proven output reaches a minimum; each has the command that runs it.

## Before the first request

- **A Private Pot with the package's handlers installed.** The coprocessor calls the Pot back with
  a selector of its own, which the Pot answers with `@sauce/zk`'s handler for it: Space and Time's
  `queryCallback(bytes32 queryId, bytes result, bytes callbackData)`, and on Base Boundless's
  `handleProof(bytes32 imageId, bytes journal, bytes seal)` and the read-only
  `isValidSignature(bytes32 hash, bytes signature)` that approves the Pot's own requests. Install
  them once per Pot, with `@sauce/async`'s public `expire(bytes32)`:
  `sauce run @sauce/zk --chain base --wallet <name> --password-env <NAME>`; a chain without one of
  the coprocessors gets the others'. A Shared Pot answers no callback.
- **The payment on the Pot**: SXT for a query, which the Pot approves the QueryRouter for (the token
  `SpaceAndTime.QueryRouter.PAYMENT_TOKEN()` names, 18 decimals); the native coin for a proof
  request, which the Pot deposits at the market.
- **The native coin for each callback.** A callback is a cook of the Pot, and its Kitchen fee comes
  from the Pot's balance.
- **The chain.** On a chain without a coprocessor, a program asking it does not compile
  (`sauce-protocols` has each one's document and deployments).

## Space and Time: `Zk.sql({ … })`

| Field         | What it is                                                                                            | Left out                    |
| ------------- | ----------------------------------------------------------------------------------------------------- | --------------------------- |
| `query`       | The proof plan: the bytes Space and Time's RPC method `commitments_v1_evmProofPlan` gives for the SQL | required                    |
| `payment`     | What the query pays, in SXT's base units: at least `SpaceAndTime.QueryRouter.baseCost()`              | required                    |
| `parameters`  | The query's serialized parameters                                                                     | none                        |
| `metadata`    | The query's metadata                                                                                  | none                        |
| `timeout`     | Seconds until the query may be cancelled and its promise expired                                      | `3600`                      |
| `gasLimit`    | The callback's gas: the handler, the body and reading the result                                      | `1000000`                   |
| `maxGasPrice` | The most per gas the callback is charged at, on Ethereum                                              | no limit: `payment` caps it |

The SQL becomes a plan off chain, once; the program takes it as a `bytes` argument. The query is
asked under the version `"latest"`, which the QueryRouter maps to its current Proof of SQL verifier.
Its result is proven against Space and Time's tables: its indexed copies of chains (Ethereum, Base
and others) and tables its users create.

### The result

The body is handed the proven table, as bytes. Read it with:

- `Zk.cell(result, column, row)`: one value of a fixed-width column (BOOLEAN, TINYINT, SMALLINT,
  INT, BIGINT, DECIMAL75, TIMESTAMP, SCALAR), as the unsigned number its big-endian bytes are: a
  negative BIGINT comes as its two's complement in 8 bytes, a DECIMAL75 as its unscaled integer, a
  TIMESTAMP in milliseconds. A VARCHAR or VARBINARY column is skipped over to reach the columns
  after it, but not read: `Zk.cell` reverts on one.
- `Zk.rows(result)`: how many rows it has.

Reading costs gas: a callback whose body read one value of a four-column result used about 300,000
gas in all, which is why the default `gasLimit` is 1,000,000. Only what the callback uses is charged.

### Unanswered: the timeout and `Zk.cancel`

Space and Time's own fulfiller answers queries; nobody else may. A query it does not answer stays
pending, its payment held. So every query has a timeout, and its promise expires at the same moment:

- after it, anyone may call the Pot's `expire(bytes32 key)`, paying at least the Kitchen's fee as
  the call's value; the promise is rejected with `Timeout(bytes32 key)` and its `.catch` runs;
- `Zk.cancel(e)` in that `.catch` cancels the query and takes its whole payment back to the Pot. For
  any other rejection (the body's own revert, after the query was answered and paid) it does
  nothing. It answers whether it cancelled.

A query answered after its promise expired is still paid for, and its body does not run: the
promise settled once.

### What the callback is trusted with

Anyone may ask a query naming the Pot as its callback, and the requester is not passed. The handler
checks the call came from the chain's CallbackExecutor, and settles only the promise parked under
the query's id; a query this Pot did not ask has no promise there, and the callback returns. The
QueryRouter answers a query once, and verifies the result before the callback: what the body is
handed is the proven table for the query the Pot asked.

## Boundless: `Zk.risc0({ … })`

```sauce chain=base
import { Zk } from "@sauce/zk";

function main(imageId: Uint256, imageUrl: bytes, input: bytes, maxPrice: Uint256, recipient: Address) {
  Zk.risc0({
    imageId,
    imageUrl,
    input,
    offer: { maxPrice, rampUpPeriod: 60, lockTimeout: 900, timeout: 1800, lockCollateral: 15000000000000000000 },
  })
    .then((journal) => {
      const [output] = abi.decode(journal, ["Uint256"]);
      evm.call(recipient, output, hex``);
    })
    .catch((e) => {
      Zk.reclaim(e);
    });
}
```

| Field      | What it is                                                                                                                                                                                               | Left out  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `imageId`  | The guest program's image id                                                                                                                                                                             | required  |
| `imageUrl` | Where proving nodes download the guest, its UTF-8 bytes                                                                                                                                                  | required  |
| `input`    | What the guest reads from stdin after the request's id                                                                                                                                                   | none      |
| `offer`    | The price and its timing: `maxPrice` (wei, deposited), `rampUpPeriod`, `lockTimeout` and `timeout` (seconds from now), `lockCollateral` (ZKC's base units, which the proving node locks), `minPrice` (0) | required  |
| `gasLimit` | The callback's gas                                                                                                                                                                                       | `1000000` |

The price rises from `minPrice` to `maxPrice` over `rampUpPeriod`; a proving node locks the request at the
price of that moment by `lockTimeout`, posting `lockCollateral`, and must fulfil it by `timeout`.
Boundless's own tooling recommends an offer from the guest's cycle count; the Pot deposits
`maxPrice` and is charged the price the request was locked at.

### The guest's side

The guest's stdin is the request's id, 32 bytes, followed by `input`, so no two requests share one.
The guest must commit, as the first 32 bytes of its journal, the sha256 of its whole stdin: the
request's predicate requires it (a prefix match on the journal), and it is how the Pot knows which
request a proof answers. The body is handed the rest of the journal.

### The Pot signs its own requests

A proving node locks a request by asking its client, the Pot, `isValidSignature(hash, signature)`
(ERC-1271), static, with 100,000 gas, and the lock spends the Pot's balance at the market. When the
program submits a request it hashes it as the market does (EIP-712, under the market's domain) and
keeps the hash; the read-only handler answers yes for those hashes and no for any other, in about
36,000 gas. A request someone else submits naming the Pot as its client cannot be locked.

### What the callback is trusted with

The callback carries no request id, and anyone may fund a request naming the Pot as its callback.
The handler checks the call came from the chain's market, and settles the promise the proof's image
id and its journal's first word name: a proof of the same guest over another stdin names another
promise, which is not there, and the callback returns. A proof delivered again finds its promise
settled. The market verifies the proof before it calls back.

### Unanswered: the deadline and `Zk.reclaim`

The request's promise expires at its deadline (`timeout` after it was made). After it, anyone may
call the Pot's `expire(bytes32 key)`, and in the `.catch`, `Zk.reclaim(e)` takes the price back: it
slashes the request if a proving node locked it and failed (the market refunds the price and keeps
the node's collateral), then withdraws the price from the Pot's balance at the market. A request no
node locked cost nothing; its deposit is withdrawn the same way. It answers whether it took the
price back, and does nothing for any other rejection.

## What it costs

- **Space and Time**: the fulfiller is paid the lesser of `payment` and the router's `baseCost()`
  plus the callback's gas priced in SXT (on Ethereum, at the transaction's gas price up to
  `maxGasPrice`; Base charges no callback gas). The rest comes back to the Pot.
- **Boundless**: the price the request was locked at, at most `maxPrice`; the market takes no fee.
  The rest of the deposit stays the Pot's balance at the market.
- **The Kitchen's fee** for each callback's cook, from the Pot's balance.
- **Storage**: the promise's word (`sauce-async`), and until it settles two more for a query (its id
  and payment, for `Zk.cancel`) or two for a proof request (its approved hash, and its index and
  price, for `Zk.reclaim`), with a counter of the Pot's requests.

## Running it

Compiling the program for its chain produces the cook transaction (`to` the Pot, `data`, `value` the
Kitchen's fee, the proof request's price paid from the Pot's balance): `sauce run` signs and sends
it, and `sauce tx` prints it unsigned for any signer. The answer arrives in the coprocessor's
transaction, not the one that asked.
