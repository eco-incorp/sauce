---
name: sauce-zk
description: Proven answers in a Sauce program with @sauce/zk — a SQL query over indexed chain data, proven with Space and Time's Proof of SQL, asked now and answered later by a callback that runs the request's .then body on the same Private Pot. Covers Zk.sql (the proof plan, the SXT payment and the QueryRouter's base cost, parameters, the timeout, the callback's gas), reading the proven result table (Zk.cell, Zk.rows), the timeout and Zk.cancel to take an unanswered query's payment back, installing the handler (sauce run @sauce/zk), what the handler checks and why only the Pot's own queries settle, where it runs (Ethereum and Base) and what it costs. Use when a program must act on chain history or indexed data it cannot read itself — balances, events, volumes or counts at past blocks — proven rather than reported, or when the user mentions ZK, a coprocessor, Proof of SQL, Space and Time or SXT.
---

# Proven answers with `@sauce/zk`

A program cannot read a chain's history, or an index of it: what an account held a month ago, how
many times an event fired, a sum over a table. Space and Time can, and proves it: a SQL query over
its indexed copies of chains, answered with a Proof of SQL that its QueryRouter verifies on chain
before it calls the asker back. `@sauce/zk` makes that query a promise of `@sauce/async`'s
(`sauce-async`): the program asks now, and its `.then` body runs on the same Private Pot when the
proven result arrives.

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

[`examples/proven-payout.sauce.ts`](examples/proven-payout.sauce.ts) is this program, with the
command that runs it.

## Before the first query

- **A Private Pot with the package's handler installed.** Space and Time calls the Pot back with
  `queryCallback(bytes32 queryId, bytes result, bytes callbackData)`, which the Pot answers with
  `@sauce/zk`'s handler. Install it once per Pot, with `@sauce/async`'s public `expire(bytes32)`:
  `sauce run @sauce/zk --chain base --wallet <name> --password-env <NAME>`. A Shared Pot answers no
  callback.
- **SXT on the Pot.** Each query pays in the token the QueryRouter names
  (`SpaceAndTime.QueryRouter.PAYMENT_TOKEN()`), SXT, 18 decimals. The Pot approves the router for
  the payment and the router pulls it when the query is asked.
- **The native coin on the Pot.** The callback is a cook of the Pot, and its Kitchen fee comes from
  the Pot's balance.
- **Ethereum or Base.** Space and Time's QueryRouter and CallbackExecutor are deployed there
  (`sauce-protocols` has their document); on any other chain the program does not compile.

## Asking: `Zk.sql({ … })`

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

## The result

The body is handed the proven table, as bytes. Read it with:

- `Zk.cell(result, column, row)`: one value of a fixed-width column (BOOLEAN, TINYINT, SMALLINT,
  INT, BIGINT, DECIMAL75, TIMESTAMP, SCALAR), as the unsigned number its big-endian bytes are: a
  negative BIGINT comes as its two's complement in 8 bytes, a DECIMAL75 as its unscaled integer, a
  TIMESTAMP in milliseconds. A VARCHAR or VARBINARY column is skipped over to reach the columns
  after it, but not read: `Zk.cell` reverts on one.
- `Zk.rows(result)`: how many rows it has.

Reading costs gas: a callback whose body read one value of a four-column result used about 300,000
gas in all, which is why the default `gasLimit` is 1,000,000. Only what the callback uses is charged.

## Unanswered: the timeout and `Zk.cancel`

Space and Time's own fulfiller answers queries; nobody else may. A query it does not answer stays
pending, its payment held. So every query has a timeout, and its promise expires at the same moment:

- after it, anyone may call the Pot's `expire(bytes32 key)`, paying at least the Kitchen's fee as
  the call's value; the promise is rejected with `Timeout(bytes32 key)` and its `.catch` runs;
- `Zk.cancel(e)` in that `.catch` cancels the query and takes its whole payment back to the Pot. For
  any other rejection (the body's own revert, after the query was answered and paid) it does
  nothing. It answers whether it cancelled.

A query answered after its promise expired is still paid for, and its body does not run: the
promise settled once.

## What the callback is trusted with

Anyone may ask a query naming the Pot as its callback, and the requester is not passed. The handler
checks the call came from the chain's CallbackExecutor, and settles only the promise parked under
the query's id; a query this Pot did not ask has no promise there, and the callback returns. The
QueryRouter answers a query once. The result is verified by the router before the callback: what
the body is handed is the proven table for the query the Pot asked.

## What it costs

- **SXT**: the fulfiller is paid the lesser of `payment` and the router's `baseCost()` plus the
  callback's gas priced in SXT (on Ethereum, at the transaction's gas price up to `maxGasPrice`;
  Base charges no callback gas). The rest comes back to the Pot.
- **The Kitchen's fee** for the callback's cook, from the Pot's balance.
- **Storage**: the promise's word (`sauce-async`), and two more words, the query's id and payment,
  until the promise settles, so `Zk.cancel` can find them.

## Running it

Compiling the program for Ethereum or Base produces the cook transaction (`to` the Pot, `data`,
`value` the Kitchen's fee): `sauce run` signs and sends it, and `sauce tx` prints it unsigned for
any signer. The answer arrives in Space and Time's transaction, not the one that asked.
