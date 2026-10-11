---
name: sauce-oracle
description: Asking a Chainlink CRE workflow for an off-chain answer from a Sauce program and continuing when its report arrives, with @sauce/oracle — Oracle.cre({ owner, args }) and its .then, .catch and deadline; the OracleRequest log a workflow's EVM Log trigger listens for; the report payload abi.encode(id, ok, data) the workflow writes through Chainlink's KeystoneForwarder to the Pot's onReport; the workflow owner as the authentication; a failed report, a reverted body and an expired request reaching .catch; installing the onReport handler and the IReceiver interface on a Private Pot on Ethereum or Base; the gas a delivery needs; and why Chainlink Functions is not used. Use when a program needs an answer from outside the chain (an API's price, a computation, a fact from the web), or the user mentions Chainlink CRE, Chainlink Functions, an oracle request, a workflow, the KeystoneForwarder or onReport.
---

# Off-chain answers with `@sauce/oracle`

A program asks a Chainlink CRE workflow for an answer and continues when the answer arrives. A
workflow is code its owner deployed to Chainlink's network: it can fetch an API, read chains and
compute, and the nodes of its DON agree on the result before it is written on chain. The request is
made now; the workflow answers in a transaction of its own, and the request's `.then` body runs
then, on the same Pot. Promises themselves (`.then`, `.catch`, deadlines, combinators) and
installing a package's handlers on a Pot are `sauce-async`'s; this skill is what the oracle adds.

```sauce chain=ethereum,base
import { Oracle } from "@sauce/oracle";

function main(owner: Address, pair: bytes, limit: Uint256, recipient: Address, amount: Uint256) {
  Oracle.cre({ owner, args: pair })
    .then((report) => {
      const [price] = abi.decode(report, ["Uint256"]);
      require(price <= limit, "above the limit");
      USDC.transfer(recipient, amount);
    })
    .catch((err) => {
      log(err);
    });
}
```

## The request

`Oracle.cre({ owner, args, deadline })` takes:

- **`owner`**, required: the workflow owner whose report answers. Any workflow's report can reach
  Chainlink's forwarder, so the forwarder alone does not say which workflow answered; the request
  is bound to the owner named in the report, and a report from any other owner answers nothing.
- **`args`**: what the workflow reads, as bytes the program encodes (`abi.encode(...)`) and the
  workflow decodes. Left out, none.
- **`deadline`**: a unix time after which the request may be expired; or `.within(seconds)` on the
  request.

The request is a log from the Pot, which the workflow's EVM Log trigger listens for:

```text
OracleRequest(bytes32 indexed id, address indexed owner, bytes args)
```

`id` is the request's own: the chain, the Pot and how many requests the Pot has made, so no two
share one, and a report meant for one chain answers nothing on another. A workflow that serves
several Pots filters on its own `owner`.

## The answer

The workflow writes a report whose payload is

```text
abi.encode(bytes32 id, bool ok, bytes data)
```

through Chainlink's KeystoneForwarder (`Chainlink.KeystoneForwarder` in a program), which checks
the DON's signatures and calls the Pot's `onReport(bytes metadata, bytes report)`:

- **`ok`** runs the body with `data`, which the body decodes as the workflow encoded it.
- **Not `ok`** runs `.catch` with `data`, the workflow's error.
- **A body that reverts** is undone, and `.catch` runs with its reason.
- **Once.** A second report for a request already answered changes nothing, and neither does a
  report from another owner; both return, so the forwarder does not retry them.
- **A request nobody answers** stays waiting until its deadline. After it, anyone may call the
  Pot's `expire(bytes32 key)`, paying the Kitchen's fee, and `.catch` runs with a timeout error
  naming the request.

With no `.catch`, a failed request runs nothing.

## What the Pot needs

A Private Pot on Ethereum or Base. The first request on it installs what it lacks to answer the
forwarder: the program it runs for `onReport(bytes,bytes)`, and `IReceiver` declared, which the
forwarder asks every receiver over ERC-165 before it delivers; a Pot that does not answer never
receives the report. A chain without a forwarder has no `onReport` to install. A Shared Pot answers
no report.

## What a delivery costs

The report's transaction is the workflow's, and the forwarder runs the body inside it, as a cook of
the Pot: the Pot pays the Kitchen's fee from its own balance, so it holds the native coin for each
answer it waits for. Give the workflow's report write a gas limit of about 250,000 plus what the
body spends: the forwarder's checks, the ERC-165 question, the cook and taking the request cost
that before the body runs.

## Chainlink Functions

Chainlink Functions, the older request-and-callback product (inline JavaScript sent with the
request, the answer delivered to a callback the consumer contract implemented), no longer answers on mainnet. Its
routers still accept a request, and the LINK it holds stays locked until the request times out.
CRE replaces it: a workflow's EVM Log trigger in place of the request, `onReport` in place of the
callback.

## Chainlink's own examples, in Sauce

Chainlink's official consumers, ported. A CRE consumer contract waits for its workflow to push a
report; a Pot asks for one, and the report runs the body, which does what the contract's
`onReport` does, in the Pot's storage and with the contract's own events. The checks a contract
writes or inherits (the forwarder, the workflow owner, ERC-165) are `@sauce/oracle`'s, so a port is
only what the contract does with the report.

| Example                                                                | Ported from                                                                                                                         | Solidity                                               | Sauce    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| [examples/data-feed.sauce.ts](examples/data-feed.sauce.ts)             | Data Feeds' `DataConsumerV3` (smartcontractkit/documentation, `public/samples/DataFeeds/DataConsumerV3.sol`)                        | 50 lines, 17 of code                                   | 4 lines  |
| [examples/reserve-manager.sauce.ts](examples/reserve-manager.sauce.ts) | CRE's proof-of-reserve `ReserveManager` (smartcontractkit/cre-templates, `starter-templates/custom-data-feed/…/ReserveManager.sol`) | 33 lines, 25 of code, beside `IReceiver`               | 12 lines |
| [examples/circuit-breaker.sauce.ts](examples/circuit-breaker.sauce.ts) | CRE's `ProtocolWithBreaker` (smartcontractkit/cre-templates, `starter-templates/circuit-breaker/…/ProtocolWithBreaker.sol`)         | 65 lines, 44 of code, on a 242-line `ReceiverTemplate` | 20 lines |

The data feed is a read, answered in the same transaction, so it needs no request: a program names
the chain's feed (`Chainlink.EthUsdFeed`) and calls it. Each port's header names its source.

## Examples

[examples/price-gate.sauce.ts](examples/price-gate.sauce.ts) pays USDC only if a workflow reports a
price at or under a limit, with an hour to answer. The three ports above are beside it.
