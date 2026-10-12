# Waiting for a callback

[Documentation](../README.md) · [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md)

Some protocols answer later, in a transaction of their own: a random number, an oracle's report, a
message from another chain, a proof. In Sauce a program asks now, and the code that uses the answer
is the request's `.then` body. The request is a promise: it
settles exactly once, fulfilled with a value or rejected with a reason. The body is compiled with
the program and runs when the protocol calls the Pot back, as the same Pot.

```js
Random.vrf({ words: 1 }).then((words) => {
  USDC.transfer(words[0] % 2 == 0 ? heads : tails, prize);
});
```

`Random.vrf` stands for a protocol's package. Every such package is built on `@sauce/async`, the
library this page describes, which the SDK resolves with no install.

## What a callback needs

- **A Private Pot with the package's handlers installed.** The protocol calls the Pot with a
  selector of its own. The Pot's Router answers it with the program its owner registered for that
  selector: the handler, which checks the call came from the protocol and settles the promise the
  callback names. A Shared Pot, and a Private Pot whose Router is fixed, answer no callback.
- **The native coin for the fee.** Each callback is a cook, and the Router pays the Kitchen's fee
  from the Pot's own balance.

Install a package's handlers once per Pot by giving the package where a program file goes:

```sh
sauce run @sauce/<package> --chain base --wallet <name>
```

`sauce compile`, `sauce tx` and `sauce simulate` take the package the same way: one cook, an
`install` for each selector the package answers and each ERC-165 interface it declares, with the
Pot's public `expire(bytes32)`. From TypeScript, `routes.packageInstall(chain, specifier)` compiles
a package's handlers for a chain, and `routes.handlersInstallSource(handlers, name, interfaces)`
writes the program that installs them.

## What the body sees

- **The program around it, as it was at the request.** Every value the body reads from the program
  is carried into it when the request is made, and the body cannot assign it. What the protocol
  delivers arrives as the body's parameters, decoded by the package.
- **One settlement.** The same answer delivered again, or one arriving after the promise settled,
  runs nothing and returns, so the protocol's transaction never fails for it. A call from anyone
  but the protocol is refused.
- **`.catch` in its place.** `.catch((e) => { … })` runs when the promise is rejected and when the
  body reverts, with everything the body did undone. With no `.catch`, the rejection is logged and
  the callback still returns.

## Combinators, timeouts and deferreds

`Promise.all`, `race`, `any`, `allSettled`, `resolve`, `reject` and `withResolvers` behave as
JavaScript's, folded while the program compiles:

```js
import { Async, Promise } from "@sauce/async";

Promise.race([Oracle.price(feed), Async.timeout(3600)])
  .then((price) => { … })
  .catch((e) => { … }); // the oracle failed, or an hour passed
```

- A request's `.within(seconds)` gives it a deadline. After it, anyone may call the Pot's
  `expire(bytes32 key)`, which rejects the promise with `Timeout(bytes32 key)`. The caller pays
  the Kitchen's fee as the call's value: the Router pays every handler's cook from the Pot's
  balance, so a handler anyone could call for free would let anyone drain the Pot, one fee a call.
- `Promise.withResolvers()` makes a promise the program settles itself in a later transaction. The
  Pot logs its key, `PromisePending(bytes32 key, uint256 deadline)`, and a later cook of the owner
  settles it with `Async.resolve(key, value)` or `Async.reject(key, reason)`.

## Writing a package

A package's request is a method on an object the program reads, or a plain function, returning a
`Request`; or a class that extends `Request` and hands `super` the same options. The three compile
to the same program:

```js
import { Handler, Request, fulfil, promiseKey, requireCaller } from "@sauce/async";

class EchoProtocol {
  request(protocol, value) {
    return new Request({
      // The program the Pot answers the protocol's callback with, installed as the request runs
      // unless it is already: it checks the caller, then settles the promise the callback names.
      handlers: [
        new Handler(ECHO_SELECTOR, (caller: Address, value: Uint256, data: bytes) => {
          requireCaller(Echo, caller); // the protocol's contract, as the chain names it
          const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
          fulfil(promiseKey(7, id), abi.encode(echoed));
        }),
      ],
      // At run time, when the statement ends: make the request, and answer the promise's key, the
      // protocol's id under a tag naming the protocol.
      send: (continuation) => {
        const asked = evm.call(protocol, 0, hex`d845a4b3`.concat(abi.encode(value))); // request(uint256)
        return promiseKey(7, abi.decode(asked, ["Uint256"])[0]);
      },
      // In the body's program, when the promise is fulfilled: decode what arrived, or fail.
      deliver: (input, body, fail) => body(abi.decode(input, ["Uint256"])[0]),
    });
  }
}
```

A protocol that carries the requester's bytes back, such as a bridge's message, says `carries:
true`. Its `send` is then handed the promise's key and the body's program to carry, and a plain
`.then` stores nothing on the Pot.

A handler is handed who called the Pot, the value it sent and the whole calldata. It captures nothing
of the program around it, since it runs on its own whenever the selector reaches the Pot: the
protocol it checks is a name the chain declares. A third argument `true` makes it a view (static, no
fee), as a signature check must be. `Erc1271.handler()` is the Pot's ERC-1271 handler, for a package
whose protocol asks the Pot to sign.

For the optional pre-install, the package lists the same handlers in its `package.json`, each a file
with `main(caller: Address, value: Uint256, data: bytes)` compiled for the Pot's chain:

```json
{
  "handlers": [{ "selector": "echo(uint256,uint256)", "program": "echo.handler.js" }],
  "interfaces": []
}
```

A declaration's `requires` lists the contracts it needs (`Namespace.Contract`), so a chain without
one skips that handler. `interfaces` lists the ERC-165 ids the Pot declares, for a protocol that
checks its receiver before it calls back.

| `@sauce/async`                                                                       | Does                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `fulfil(key, value)`, `reject(key, reason)`                                          | Settle a promise and run its body or its `.catch`; a settled key, nothing.            |
| `settleCarried(key, stored, program, value, ok)`                                     | The same, for a protocol that carried the body back.                                  |
| `promiseKey(tag, id)`                                                                | A protocol's id as a promise's key.                                                   |
| `requireCaller(expected, actual)`, `requireSelf(sender)`                             | A handler's checks: the protocol called; this Pot sent the message.                   |
| `expire(key)`                                                                        | Reject a promise past its deadline with `Timeout(bytes32)`.                           |
| `new Handler(selector, (caller, value, data) => { … }, readOnly?)`                   | A handler a request installs (`handlers`); `.ensure()` installs it unless in place.   |
| `ensureInstalled(selector, program, readOnly)`                                       | The same for a program known only as the request runs.                                |
| `ensureInterface(id)`                                                                | Declare an ERC-165 id unless declared: a request's `interfaces`.                      |
| `install(selector, program, readOnly)`, `declareInterface(id, supported)`            | What installing a handler calls.                                                      |
| `winner()`                                                                           | In a race's or an any's continuation: the child that settled it.                      |
| `received()`, `fulfilled()`                                                          | Deprecated: what `run` handed its program. A continuation takes it as its parameters. |
| `park`, `run`, `salt`, `isPending`                                                   | The settlement table's parts, for a package that needs them directly.                 |
| `Erc1271.approve(hash)`, `Erc1271.revoke(hash)`, `isValidSignature(hash, signature)` | The Pot as an ERC-1271 signer (above).                                                |

## The Pot as a signer

A Pot answers ERC-1271's `isValidSignature(bytes32 hash, bytes signature)` with one handler the
core ships, `@sauce/async/erc1271.handler.js`, which a package that needs the Pot to sign declares
as its own (a view). Installing two such packages installs it once. It is valid for:

- a hash a program running as the Pot approved, `Erc1271.approve(hash)` (and `Erc1271.revoke`),
  kept in the ERC-7201 namespace `sauce.storage.Erc1271`, whatever the signature bytes, since the
  approval is the authorization: a request the Pot made itself, which a
  market checks with at most 100,000 gas before it spends the Pot's deposit. The check is one
  storage read, about 42,000 gas for the call;
- the owner's signature over the hash bound to the Pot, EIP-712's `PotMessage { hash: bytes32 }`
  under the domain `{ name: "Sauce Pot", version: "1", chainId, verifyingContract: the Pot }`: never
  over the bare hash, so a signature the owner made for its own account or another Pot is not this
  Pot's. A malleable signature (an upper-half `s`) is refused, and an owner that is a contract is
  asked ERC-1271 itself, as OpenZeppelin's `SignatureChecker` does.

## Storage and cost

A pending promise is one word in the Pot's storage, in the ERC-7201 namespace
`sauce.storage.Async`: the address of its body's code, its deadline, its state and its flags. Up
to three words the body captured sit beside it, and more go into code. The body's code is deployed
once per Pot, by CREATE2 at an address its bytes decide, and shared by every request that compiles
to it. Settling clears the word. A carried `.then` stores nothing. A combinator parks a word of its
own and one per child, and keeps each child's value until it is decided: a value of a word or less
in a storage slot, a longer one as code, which costs a CREATE2 but less for each further word.

## Oracles: `@sauce/oracle`

`Oracle.cre(...)` asks a [Chainlink CRE](https://docs.chain.link/cre) workflow for an answer
computed off chain: code the workflow's owner deployed to Chainlink's network, which can fetch an
API, read chains and compute, and whose DON agrees on the result. The body runs when the
workflow's report reaches the Pot:

```js
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

- **The request** is a log from the Pot, `OracleRequest(bytes32 indexed id, address indexed owner,
bytes args)`, which the workflow's EVM Log trigger listens for. `args` is what the workflow
  reads.
- **The answer** is a report whose payload is `abi.encode(bytes32 id, bool ok, bytes data)`,
  delivered by Chainlink's KeystoneForwarder (`Chainlink.KeystoneForwarder`) through the Pot's
  `onReport(bytes metadata, bytes report)`. An `ok` report runs the body with `data`; any other
  runs `.catch` with `data`, the workflow's error.
- **`owner` is required.** Any workflow's report can reach the forwarder, so the request is bound
  to the workflow owner named in the report's metadata, and a report from another owner finds no
  request. A report for a request already settled changes nothing.
- **A request nobody answers** expires: give it `deadline` (a unix time) or `.within(seconds)`, and
  after it anyone may call the Pot's `expire(bytes32 key)`, which runs `.catch` with
  `Timeout(bytes32 key)`.
- **The first request** on a Pot installs what it lacks: the `onReport` handler, and `IReceiver`
  declared, which the forwarder checks over ERC-165 before each delivery. It runs on Ethereum and
  Base.
- **The delivery's gas is the workflow's.** The forwarder runs the body in the report's
  transaction: about 250,000 gas for a short body, plus what the body spends, in the workflow's
  report write.

Chainlink Functions, the request-and-callback product CRE replaces, no longer answers on mainnet:
its routers still accept a request, and the LINK it holds stays locked until the request times
out.

### Chainlink's own examples, in Sauce

Chainlink's official consumers, ported to Sauce and executed in the SDK's tests: the CRE ones
through Chainlink's own forwarder, the data feed against Ethereum's state. A CRE consumer contract
waits for its workflow to push a report; a Pot asks for one, and the report runs the body, which
does what the contract's `onReport` does, in the Pot's storage and with the contract's own events.
The checks the contracts write or inherit, the forwarder, the workflow owner and ERC-165, are
`@sauce/oracle`'s, so a port is only what the contract does with the report.

| Contract                                | Source                                                                                                                                                                                                                                    | Solidity                                               | Sauce    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| Data Feeds' `DataConsumerV3`            | [documentation `DataConsumerV3.sol`](https://github.com/smartcontractkit/documentation/blob/5dbdbb0fcfe5401df47a13389b806120b78d7f73/public/samples/DataFeeds/DataConsumerV3.sol)                                                         | 50 lines, 17 of code                                   | 4 lines  |
| CRE's proof-of-reserve `ReserveManager` | [cre-templates `ReserveManager.sol`](https://github.com/smartcontractkit/cre-templates/blob/d0223f31182c76bc36b1cc9d47b13b18efcf2bf6/starter-templates/custom-data-feed/cre-custom-data-feed-go/contracts/evm/src/ReserveManager.sol)     | 33 lines, 25 of code                                   | 12 lines |
| CRE's `ProtocolWithBreaker`             | [cre-templates `ProtocolWithBreaker.sol`](https://github.com/smartcontractkit/cre-templates/blob/d0223f31182c76bc36b1cc9d47b13b18efcf2bf6/starter-templates/circuit-breaker/circuit-breaker-ts/contracts/evm/src/ProtocolWithBreaker.sol) | 65 lines, 44 of code, on a 242-line `ReceiverTemplate` | 20 lines |

`DataConsumerV3` is a read: the contract is deployed with its feed's address and returns the
feed's latest answer. In Sauce a program names the chain's feed and calls it, with no deployment:

```js
function main(): Uint256 {
  require(Chainlink.EthUsdFeed); // the chain has the feed
  return Chainlink.EthUsdFeed.latestRoundData().answer;
}
```

`ReserveManager` records the total minted and the total reserve a proof-of-reserve workflow
reports, counts the update, and emits `RequestReserveUpdate`. In Sauce the program asks the
workflow, and the report runs the same steps:

````js
import { Oracle } from "@sauce/oracle";

function main(owner: Address) {
  Oracle.cre({ owner }).then((report) => {
    const [totalMinted, totalReserve] = abi.decode(report, ["Uint256", "Uint256"]);
    // Where the Pot keeps what the contract keeps, at keccak256 of each name.
    evm.sstore(crypto.keccak256("ReserveManager.lastTotalMinted"), totalMinted);
    evm.sstore(crypto.keccak256("ReserveManager.lastTotalReserve"), totalReserve);
    const counter = crypto.keccak256("ReserveManager.requestIdCounter");
    evm.sstore(counter, evm.sload(counter) + 1);
    const update = crypto.keccak256("RequestReserveUpdate((uint256,uint256))");
    log(abi.encode(totalMinted, totalReserve), update);
## Randomness: `@sauce/random`

`@sauce/random` asks for verifiable randomness and hands it to the body: `Random.vrf` from
Chainlink VRF, on Ethereum and Base, and `Random.entropy` from Pyth Entropy, on Base. A coin flip
for a prize:

```js
import { Random } from "@sauce/random";

function main(heads: Address, tails: Address, prize: Uint256) {
  Random.vrf({ words: 1 }).then((words) => {
    USDC.transfer(words[0] % 2 == 0 ? heads : tails, prize);
  });
}
````

The contract takes `onReport` from anyone; the Pot runs the body only for a report Chainlink's
forwarder delivers from the workflow owner it asked. `ProtocolWithBreaker` is the same shape with
a branch: a report of `(uint8 action, string reason)` pauses the protocol and counts a trip, or
resumes it, each with the contract's event.

| Request                                               | The body receives                     | Defaults                                             |
| ----------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `Random.vrf({ words, confirmations, gas, deadline })` | `words` random numbers, a `Uint256[]` | 1 word, 3 confirmations, `gas` sized, no deadline    |
| `Random.entropy({ provider, gas, deadline })`         | one random 32-byte number             | Entropy's default provider, `gas` sized, no deadline |

- **The Pot pays twice.** The request pays the provider's price in the native coin from the Pot's
  balance when the program runs: VRF's wrapper price at the transaction's gas price, or Entropy's
  fee. Exactly the price is paid, since both providers keep any excess. The callback's cook pays
  the Kitchen's fee, so a request is refused unless the Pot keeps that fee after paying the price.
- **`gas` is the callback's gas limit,** fixed and paid for with the request. Left out, the package
  sizes it from what the callback runs as compiled: reaching the body, then an allowance for each
  byte of the body, and of a combinator's body when the request is raced or joined. That covers
  writes, hashing and a few token transfers; a body that loops, or calls out more than its size
  suggests, needs `gas` given. VRF gives the callback exactly that much, and a callback that runs
  out is spent, never retried.
- **A callback never fails for the body.** A body that reverts is undone and its `.catch` runs, or
  the Pot logs it unhandled; the handler first logs what arrived,
  `RandomDelivered(bytes32 key, bytes value)`. A second delivery, or an answer after the request
  expired, runs nothing. A call from anyone but the provider is refused.
- **A request may never be answered.** Give it a deadline (`deadline`, or `.within(seconds)`), after
  which anyone may call the Pot's `expire`, or race it against `Async.timeout`.
- **Keys** are the provider's own ids: VRF's request id under its wrapper, and Entropy's sequence
  number under its provider and the Entropy contract, since sequence numbers count per provider.

### The official examples, in Sauce

Chainlink's and Pyth's own example consumers port to Sauce with their behaviour kept: the
contract's state in the Pot's storage, its events from the Pot, its callback as `.then`. A Pot
already has what a contract needs only to exist (a constructor, an owner check, a `receive`, the
check on who calls back), so each port is a fraction of the original:

| Official example (Solidity)              | In Sauce                                                                   | Lines (code)        |
| ---------------------------------------- | -------------------------------------------------------------------------- | ------------------- |
| Chainlink `DirectFundingConsumer.sol`    | two VRF words, paid by direct funding; the request's status kept           | 119 (66) → 42 (18)  |
| Chainlink `SubscriptionConsumer.sol`     | the same, paid by direct funding in place of a subscription                | 109 (57) → 41 (19)  |
| Chainlink `VRFD20.sol`                   | a d20 rolled once per roller, and `house(player)` as a read                | 173 (80) → 86 (46)  |
| Pyth `CoinFlip.sol`                      | a fair coin, `FlipRequest` and `FlipResult` logged                         | 128 (64) → 33 (11)  |
| Pyth `NFTGrowth.sol` (and its `NFT.sol`) | a token levelled up, unchanged or killed; its ten-minute unlock a deadline | 183 (141) → 61 (34) |

The sources are `smartcontractkit/documentation`'s `public/samples/VRF/v2-5/` and
`pyth-network/pyth-examples`' `entropy/`; code lines leave out comments, blank lines, and the pragma and import lines. Each port numbers its requests in the Pot's own storage, so a record is keyed by that
number rather than by the provider's id, which keys the promise. Pyth's CoinFlip, whole:

```js
import { Random } from "@sauce/random";

function main(): Uint256 {
  const flips = crypto.keccak256("CoinFlip.flips");
  const sequenceNumber = evm.sload(flips) + 1;
  evm.sstore(flips, sequenceNumber);
  Random.entropy().then((randomNumber) => {
    const isHeads = randomNumber % 2 == 0;
    log(abi.encode(sequenceNumber, isHeads), crypto.keccak256("FlipResult(uint64,bool)"));
  });
  log(abi.encode(sequenceNumber), crypto.keccak256("FlipRequest(uint64)"));
  return sequenceNumber;
}
```

A request installs the handler its callback reaches in its own transaction, unless the Pot already
answers with it, so there is nothing to install first. Installing them ahead of time only makes the
first request cheaper; on a chain with one provider only its handler installs:

```sh
sauce run @sauce/random --chain base --wallet <name>
```

## Proofs: `@sauce/zk`

`@sauce/zk` asks a ZK coprocessor a question now and hands its proven answer to `.then`. It speaks
two: Space and Time, on Ethereum and Base, answers a SQL query over its indexed copies of chains,
proven with Proof of SQL, which its QueryRouter verifies before its CallbackExecutor calls the Pot
back; Boundless, on Base, proves a RISC Zero guest program ran on an input, which its market
verifies before it calls the Pot back with the guest's journal.

```js
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

- **The query** is a proof plan, the bytes Space and Time's RPC method
  `commitments_v1_evmProofPlan` gives for the SQL, passed to `main`. `Zk.sql` asks it under the
  `"latest"` version, the QueryRouter's own verifier. Its other fields are `parameters`,
  `metadata`, `timeout` (3600 seconds), `gasLimit` (1,000,000) and `maxGasPrice`.
- **The payment** is in SXT, the token `SpaceAndTime.QueryRouter.PAYMENT_TOKEN()` names, at least
  the router's `baseCost()`; the Pot holds it, and approves the router for it. The fulfiller is
  paid the base cost and, on Ethereum, the callback's gas; the rest comes back to the Pot.
- **The result** is Proof of SQL's table. `Zk.cell(result, column, row)` reads a value of a
  fixed-width column as an unsigned number (a negative BIGINT as its two's complement in 8 bytes),
  `Zk.text(result, column, row)` the bytes of a VARCHAR or VARBINARY value, and `Zk.rows(result)`
  counts the rows.
- **The timeout.** Only Space and Time's fulfiller answers queries, and it may not answer one. A
  query's promise expires at its timeout: anyone may then call the Pot's `expire(key)`, its
  `.catch` runs, and `Zk.cancel(e)` there cancels the query and takes its payment back. If the
  router refuses the cancellation, the Pot keeps the query's record, and a later program may call
  `Zk.cancel` again with the same reason.
- **The checks.** The handler takes calls only from the chain's CallbackExecutor, and settles only
  the promise under a query id the Pot asked: a query someone else asked naming the Pot settles
  nothing. The first query installs the handler on the Pot, and with it the public `expire`;
  `sauce run @sauce/zk --chain base --wallet <name>` installs them beforehand, an optional pre-warm.

Reading a result costs gas (a four-column result read once took about 250,000 of the callback's
gas), and the Pot keeps a query's id and payment in two words until its promise settles.

`Zk.risc0({ imageId, imageUrl, input, offer })` asks Boundless instead:

- **The request** is the market's own `ProofRequest`, the Pot its client and its callback. The
  offer is the market's: `maxPrice` (wei, which the Pot deposits), `rampUpPeriod`, `lockTimeout`,
  `timeout` and `lockCollateral` (the ZKC a prover locks), and `minPrice`. Any prover may lock it.
- **The guest** reads the request's id, 32 bytes, then `input`, from stdin, and must commit the
  sha256 of its whole stdin as the first 32 bytes of its journal. The body is handed the rest.
- **A journal known in advance.** A guest that proves a claim about its input, as Boundless's own
  examples do, commits an output the program can state: given as `journal`, the guest runs as
  published, reading `input` alone, and the request asks for exactly that journal (a digest match,
  as Boundless's own tooling asks). The body is handed the whole journal. The Pot keeps one such
  request pending per guest and journal.
- **The Pot signs its own requests.** A prover's lock asks the client `isValidSignature` (ERC-1271)
  with 100,000 gas. The program hashes each request as the market does and approves the hash
  (`Erc1271.approve`, above), and the Pot's one ERC-1271 handler answers yes for it, in about 38,000
  gas, so nobody else's request can spend the Pot's balance at the market.
- **The checks.** The callback carries no request id: the handler takes calls only from the market,
  and settles the promise the proof's image id and its journal name (the journal's sha256 for a
  request that named it, its first word for any other), so a proof of the same guest over another
  input, or of another journal, settles nothing.
- **The deadline.** At `timeout` the promise expires; `Zk.reclaim(e)` in its `.catch` slashes the
  request if a prover locked it and failed (unless someone has already), and withdraws its price
  once it is back in the Pot's balance at the market. If the market refuses either, the Pot keeps
  the request's record, and a later program may call `Zk.reclaim` again with the same reason.

### The protocols' own examples, ported

Each coprocessor publishes an example consumer: a contract that asks, or an app that asks for it,
and a callback or a call that uses the proven answer. Ported, each is one program that asks and
acts on the answer in its `.then`, with no contract to deploy. The SDK's suites run each against
the protocol's own contracts.

| Example                                                                                                                                                                | The original, in lines of code                                     | Sauce |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----- |
| Space and Time's tutorial: `spaceandtimefdn/sxt-chain-examples`, `contracts/src/HelloWorld/HelloWorld.sol` and its constants, `contracts/src/libraries/ProofOfSQL.sol` | 52 of Solidity                                                     | 14    |
| Boundless's template: `boundless-xyz/boundless-foundry-template`, `contracts/src/EvenNumber.sol`, `IEvenNumber.sol` and the app, `apps/src/main.rs`                    | 25 of Solidity, and the app that asks and calls `set`, 106 of Rust | 23    |
| Boundless's callback example: `boundless-xyz/boundless`, `examples/counter-with-callback`: `Counter.sol`, `ICounter.sol` and the app                                   | 30 of Solidity, and the app that asks, 89 of Rust                  | 25    |
| Succinct's SP1 template: `succinctlabs/sp1-project-template`, `contracts/src/Fibonacci.sol`                                                                            | 24 of Solidity                                                     | 7     |

Lines of code leave out blank lines, comments and the apps' tests. Each original's own contracts
are counted; the protocols' interfaces and libraries they import (`IQueryRouter`, Proof of SQL's
table decoder, `BoundlessMarketCallback`, `ISP1Verifier`) are the protocols', as `@sauce/zk` is the SDK's, and are
counted on neither side.

Space and Time's tutorial asks a query of a table its users created and logs each name in the
answer. The Pot pays the SXT from its balance and takes back what the fulfiller is not paid;
`payment` is an argument because the routers' base costs differ (100 SXT on Base, what the tutorial
pays, and 1,000 on Ethereum); the query names the router's latest verifier, where the tutorial pins
an earlier one's address; and the callback may use 300,000 gas, where the tutorial gives 100,000.
Given the answer the tutorial's own query got on Ethereum, the Pot logs the event the tutorial's
contract logged, byte for byte:

```js
import { Zk } from "@sauce/zk";

// The query's proof plan, as Space and Time's RPC method `commitments_v1_evmProofPlan` gives it.
const QUERY_PLAN = hex`0000000000000001000000000000003d5455544f5249414c5f414243384437303943383032363239363533343446353234304144313233463543424535313132332e48454c4c4f5f574f524c440000000000000002000000000000000000000000000000044e414d4500000007000000000000000000000000000000094c4f4e47495455444500000005000000000000000100000000000000044e414d45000000000000000000000000000000020000000000000000000000010000000100000005000000000000003c0000000000000001000000000000000000000000`;

function main(payment: Uint256): void {
  Zk.sql({ query: QUERY_PLAN, payment, gasLimit: 300000, maxGasPrice: 10 * 10 ** 9 })
    .then((result) => {
      const names = Zk.rows(result);
      for (let i = 0; i < names; i += 1) {
        log(abi.encode(Zk.text(result, 0, i)), crypto.keccak256("QueryFulfilled(string)"));
      }
    })
    .catch((e) => {
      Zk.cancel(e);
    });
}
```

Boundless's template proves a number even with its guest, `is-even`, which reads the number and
commits it, and its contract keeps the number once its app calls `set` with the proof. The Pot asks
for exactly that journal and keeps the number when the market calls back, so there is no `set` to
send and no seal to verify again; the number is kept in the Pot's storage:

```js
import { Zk } from "@sauce/zk";

function main(number: Uint256, imageId: Uint256, imageUrl: bytes, maxPrice: Uint256): void {
  Zk.risc0({
    imageId,
    imageUrl,
    input: abi.encode(number),
    journal: abi.encode(number),
    offer: {
      maxPrice,
      rampUpPeriod: 60,
      lockTimeout: 900,
      timeout: 1800,
      lockCollateral: 15000000000000000000,
    },
  })
    .then((journal) => {
      const [even] = abi.decode(journal, ["Uint256"]);
      evm.sstore(crypto.keccak256("EvenNumber.number"), even);
    })
    .catch((e) => {
      Zk.reclaim(e);
    });
}
```

Boundless's callback example asks its `echo` guest to echo the time, with the counter as the
request's callback, and counts each proof the market calls back with, keeping a table of proofs seen
so none counts twice. The Pot counts each once because its promise settles once:

```js
import { Zk } from "@sauce/zk";

function main(imageId: Uint256, imageUrl: bytes, maxPrice: Uint256): void {
  const message = abi.encode(ctx.timestamp());
  Zk.risc0({
    imageId,
    imageUrl,
    input: message,
    journal: message,
    offer: {
      maxPrice,
      rampUpPeriod: 60,
      lockTimeout: 900,
      timeout: 1800,
      lockCollateral: 15000000000000000000,
    },
    gasLimit: 300000,
  })
    .then((journal) => {
      const count = crypto.keccak256("Counter.count");
      evm.sstore(count, evm.sload(count) + 1);
    })
    .catch((e) => {
      Zk.reclaim(e);
    });
}
```

Succinct's SP1 template is the other kind: its proof is made off chain beforehand and arrives with
the call, and its contract checks it there through Succinct's SP1 verifier gateway, then returns the
proven Fibonacci numbers. No request, callback or promise, and no `@sauce/zk`: the program calls the
gateway, `Succinct.VerifierGatewayGroth16` on Ethereum and Base, which reverts unless the proof
verifies, and returns what the proof shows. The verification key is a constant, where the template's
contract takes it in its constructor:

```js
const FIBONACCI_PROGRAM_VKEY = 0x004a55ed3c7a07d0233a027278a8b7ff8681ffbd5d1ec4795c18966f6e693090;

function main(publicValues: bytes, proof: bytes): { n: Uint256; a: Uint256; b: Uint256 } {
  require(Succinct.VerifierGatewayGroth16);
  Succinct.VerifierGatewayGroth16.verifyProof(FIBONACCI_PROGRAM_VKEY, publicValues, proof);
  const [n, a, b] = abi.decode(publicValues, ["Uint256", "Uint256", "Uint256"]);
  return { n, a, b };
}
```

A proof's first four bytes name the SP1 version that made it, and the gateway refuses a version
Succinct has frozen (`RouteIsFrozen`). The template as published produces proofs the live gateway
refuses until it moves to a live version: its fixture is a proof of SP1 v6.0.0, whose routes
Succinct has frozen on both chains, so through the gateway as the chain holds it the template's own
proof is refused. With that one route as it stood before the freeze, the version's verifier checks
the proof and the program returns 20, 6765 and 10946. The path that works today is a live version's
proof: one that Cosmos IBC's SP1 light client had the gateway verify on Ethereum verifies inside a
program of the same shape, trusting that app's key, through the live route as the chain holds it,
and on Base's gateway too. A Groth16 verification costs about 226,000 gas.

## Owner-signed programs: `@sauce/signed`

A Private Pot runs a program when its owner cooks it. With `@sauce/signed` installed, it also runs
a program its owner **signed**, for whoever submits it: a relayer that pays the gas, a counterparty
that pays in and runs the owner's side in the same transaction, or a hop's body that delivers to
the owner's Pot on another chain. The Pot runs it with everything it holds, once, only if:

- the owner signed it for this Pot, on this chain;
- it is exactly the bytes signed, its arguments included;
- its salt is not used yet;
- its deadline has not passed.

A Pot is set up once, by its owner, because only the owner can make the Pot answer a selector.
The first time you sign for a Pot, `sauce sign` sets it up before it signs: it deploys the Pot if
it has no code and installs the handlers, asking once (`--yes` approves). Any owner cook that uses
`Signed` sets it up too as it runs: `Signed.setup()`, and `Signed.cancel(salt)` and
`Signed.invalidate(word, mask)`, which call it. Or do it ahead of time:

```sh
sauce run @sauce/signed --chain base --wallet <name>
```

The Pot then answers three calls:

| Call                                                                                                                 | Mode                      | Does                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| `execute(bytes program, bytes32 salt, uint256 deadline, bytes signature)`                                            | cook, paid by the Pot     | Runs `program` when the owner signed it, and returns what it returns                       |
| `executeAcross(bytes program, bytes32 salt, uint256 deadline, bytes32[] executions, uint256 index, bytes signature)` | cook, paid by the Pot     | The same, from one signature over a program per chain                                      |
| `isValidSignature(bytes32 hash, bytes signature)`                                                                    | view, static, with no fee | EIP-1271 for the Pot, the core's handler: the owner's signature of `hash` bound to the Pot |

### Signing from TypeScript

The owner signs EIP-712 typed data, so any wallet can. `routes` builds it and the call:

```ts
import { routes } from "@eco-incorp/sauce";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const owner = createWalletClient({ account: privateKeyToAccount(key), transport: http(rpcUrl) });
const compiled = routes.compileSauceProgram("base", source);
const execution = {
  pot, // the owner's Private Pot on Base
  chainId: 8453,
  program: routes.signedProgram(compiled, [recipient, 25_000_000n]), // bytecode ++ arguments
  salt: routes.signedSalt(), // 32 random bytes; each runs once
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
};
const signature = await owner.signTypedData(routes.executeTypedData(execution));
// Anyone sends it: { to: pot, data, value: 0 }.
const data = routes.encodeExecute({ ...execution, signature });
```

The domain is `{ name: "Sauce Pot", version: "1", chainId, verifyingContract: pot }` and the
message `Execute { bytes program, bytes32 salt, uint256 deadline }`. The signature is the owner's
65-byte signature with `s` in the lower half of the curve's order, which every wallet makes. An
owner with code answers EIP-1271 instead, with a signature of any length.

### Signing from the command line

`sauce sign` compiles a program with `main`'s arguments as `sauce tx` does. It prints the typed
data, and with the owner's key the signature and the `execute` call for anyone to send:

```sh
sauce sign pay.sauce.ts --chain base --wallet <name> --within 3600 --args 0x… 25000000
```

- **With no signer**, it prints the typed data alone, after the `setup` transactions a Pot not set
  up yet needs first, for the owner to send.
- **The deadline** is `--within <seconds>` from now, or `--deadline <unix seconds>`.
- **The salt** is random unless `--signed-salt` gives one.

### The program the owner signs

Anyone may submit a signed program as soon as it exists, so it checks what it needs to be true when
it runs:

```js
function main(recipient: Address, amount: Uint256): void {
  require(USDC.balanceOf(ctx.self()) >= amount, "not delivered yet");
  USDC.transfer(recipient, amount);
}
```

Submitted early, it reverts. A revert undoes the use of its salt too, so the same signature runs
once the USDC is there.

- **From another program:** `submit(pot, program, salt, deadline, signature)` from `@sauce/signed`
  makes the call. A program that pays into the owner's Pot and then submits does both or neither.
- **From a hop:** the body on the destination's Shared Pot transfers what it received to the owner's
  Pot and calls its `execute`, all in the fill. A hop's body reads only what is fixed when the
  intent is published, so the signed call is written into the file as a constant:
  `evm.call(pot, 0, SIGNED)`.

### Cancelling, and one signature for several chains

- **Cancelling:** the owner cancels an unused salt with a program it cooks, `Signed.cancel(salt)`.
  `Signed.invalidate(word, mask)` cancels up to 256 salts that share a word. Salts are Permit2's unordered
  nonces: one bit per salt, 256 to a word, in the ERC-7201 namespace `sauce.storage.Signed`.
  `routes.signedSaltSlot(salt)` says where a salt is recorded, and `routes.cancelSaltsSource(salts)`
  writes the cancelling program.
- **Several chains:** `executeAcross` takes one signature over `Executions { Execution[] }`, each
  `{ chainId, program, salt, deadline }`, under a domain with no chain id. A Private Pot has the
  same address on every chain. `routes.executeAcrossTypedData` and `routes.encodeExecuteAcross`
  build both sides.

### Permit2 and EIP-1271

`@sauce/signed` installs the core's ERC-1271 handler ([The Pot as a signer](#the-pot-as-a-signer)).
Its owner signs `PotMessage { bytes32 hash }` under the Pot's domain (`routes.potMessageTypedData`),
never `hash` itself. Permit2 then takes the Pot as a signer. A permit the owner signs for its own
account is never spent from the Pot, nor one bound to another of its Pots.

### What it costs

Whole transactions on a local chain, the program returning a number:

| Path                                                   | Gas      |
| ------------------------------------------------------ | -------- |
| The owner cooks the program itself                     | ~48,000  |
| `execute`, a salt whose word is new to the Pot         | ~138,000 |
| `execute`, a salt whose word is already written        | ~121,000 |
| The same check written in Solidity, then the same cook | ~75,000  |
| `isValidSignature` on the Pot                          | ~81,000  |
| Installing the package, once per Pot                   | ~780,000 |

The difference from Solidity has three parts:

- the Router's dispatch, which every handler pays;
- the engine running the check;
- the call that runs the signed program inside the same cook.

A native `execute` is possible as a Router function. It would not touch the Pot contract.

## Messages across chains: `@sauce/remote`

A Private Pot has the same address on every chain its owner mints it on. `@sauce/remote` sends a
program to that same Pot on another chain, over a bridge, and the Pot there runs it when the bridge
delivers it, with the storage and balances it holds there. With a `.then`, the answer comes back,
and the message is a promise like any other:

```js
// Compiled for Ethereum.
function main(bump: Uint256) {
  Base.remote(() => {
    return USDC.balanceOf(self); // on Base, as this same Pot: Base's USDC
  })
    .then((result) => {
      // Back on Ethereum: the bytes the body returned, one word here.
      const [balance] = abi.decode(result, ["Uint256"]);
      evm.sstore(2, balance + bump);
    })
    .catch((e) => {
      // Back on Ethereum: the body reverted on Base, everything it did undone there.
      evm.sstore(3, crypto.keccak256(e));
    });
}
```

`<Chain>.remote(body, options)` is a method of every chain's name. The body is compiled for that
chain, with its names, and reads the program around it as it was when the message was sent.

- **One way.** With no `.then` or `.catch`, nothing comes back. A body that reverts reverts the
  delivery, and the bridge can deliver the message again later, when it may succeed.
- **A round trip.** The body runs there in a frame of its own. What it returns is sent back over
  the same bridge and fulfils the promise here; what it reverted with is sent back instead and
  rejects it, everything it did there undone. With no `.catch`, the rejection runs nothing and is
  logged as unhandled: a body that should wait and be delivered again belongs in a one-way
  message.
- **Combinators and deadlines.** A remote message is a promise among others:
  `Promise.all([Base.remote(…), Optimism.remote(…)])` runs its body once both chains answered, each
  answer in the order listed, and `Promise.race` takes the first, the later answer delivered and
  ignored. `.within(seconds)` gives it a deadline after which anyone may `expire` it, and an answer
  that comes later is ignored.
- **The bridge.** A message takes the first of Hyperlane, LayerZero, Metalayer and Polymer that both
  chains have, or the one `via` names: `Base.remote(body, { via: "layerzero", gas: 400000 })`. `gas`
  is what the destination's handler is given, `replyGas` the same for the way back. Hyperlane,
  LayerZero and Metalayer relay a paid message on their own. Polymer relays nothing: the sending Pot
  emits a log, and someone fetches its proof from Polymer's prove API and calls the destination
  Pot's `deliver(bytes proof)`. Each bridge's deployments are in
  [Protocols](../reference/protocols.md).
- **What it costs, and where.** Each leg is paid on the chain it leaves, from that chain's Pot: the
  bridge's fee, which the program reads from the bridge as it sends, and on the receiving side the
  Kitchen's fee for each message the handler runs. Fund both Pots before you send.

A bridge delivers a message by calling the Pot with its own callback, which the Pot answers with
the bridge's receiver: a handler. The Pot a round trip is cooked on installs the receiver its answer
reaches as the program runs, unless it is there already. The Pot on the other chain must already
answer when the message lands: deployed there, its receiver installed by its owner (only the owner
can), and holding the Kitchen's fee for the message and, for a round trip, the bridge's fee for the
answer. `sauce run` and `sauce tx` read that Pot before the cook and offer what is missing as part
of the cook's setup, in the same single question as deploying the Pot the cook runs on: deploy the
Pot there, install the message's bridge's receiver, and fund it with exactly the Kitchen's fee for
each message plus each answer's fee, quoted from the bridge ("fund your Pot on Base with … ETH (1
delivery × the Kitchen fee + the answer's Hyperlane fee, quoted for up to … bytes)"); `--yes`
approves them, and what is left over stays in the Pot. `sauce tx` and `sauce_tx` list them ahead of
the cook, each with its `chainId`. `sauce run @sauce/remote --chain base --wallet <name>` installs
every receiver a chain has ahead of time:

| Bridge    | The Pot answers                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Hyperlane | `handle(uint32,bytes32,bytes)`, from the chain's Mailbox                                             |
| Metalayer | `handle(uint32,bytes32,bytes,(uint32,address,bytes)[],bytes[])`, from the chain's MetalayerRouter    |
| LayerZero | `lzReceive(...)`, from the chain's EndpointV2, and, read-only, `allowInitializePath` and `nextNonce` |
| Polymer   | `deliver(bytes proof)`, from anyone                                                                  |

Each handler checks that its caller is the bridge's contract on that chain and that the message's
sender on its origin chain is this same Pot before it runs anything. A Polymer proof is checked by
Polymer's prover on that chain, must be of a log this Pot emitted for this chain, and runs once.

A message sent to a Pot that is not ready, with no Pot on that chain yet or no handler for its
bridge, waits: its delivery fails and nothing runs. Hyperlane, LayerZero and Metalayer deliver it
again once the Pot answers, and a Polymer proof can be submitted any time later. It is not lost,
and it runs once.

An intent moves money to another chain; a remote message does the stateful part on the Pot that
owns it. They arrive in no set order, so a one-way message's body checks what it needs and reverts
until it is there:

```js
function main(amount: Uint256, owner: Address) {
  const pot = ctx.self(); // this Pot's address, the same on Base
  Base.hop({
    send: { token: USDC, amount: amount + amount / 100 },
    receive: { token: USDC, amount },
    refundee: owner,
  }).then(() => {
    USDC.transfer(pot, amount); // on Base, from the intent's Pot to this one
  });
  Base.remote(() => {
    require(USDC.balanceOf(self) >= amount, "not arrived yet");
    USDC.approve(AaveV3.Pool, amount);
    AaveV3.Pool.supply(USDC, amount, self, 0);
  });
}
```

### The bridges' own examples, in Sauce

Each bridge publishes an example app: a contract deployed on two chains, each set up to trust the
other. Each is ported here to one Sauce program, which deploys nothing: it runs on the owner's Pot
on the chain it is cooked on, Ethereum below, and its body on the same Pot on Base.

| Bridge    | Official example                                                                                                                                                                                                                                                                                                                               | Solidity | Sauce |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| Hyperlane | [HelloWorld.sol](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/18c32ed2b608bfb02183b5028e2406c5153a3754/typescript/helloworld/contracts/HelloWorld.sol)                                                                                                                                                                             | 62       | 25    |
| LayerZero | [MyOApp.sol](https://github.com/LayerZero-Labs/devtools/blob/508363b50abf8215363a9d3aaddaf2ca5021c9ec/examples/oapp/contracts/MyOApp.sol)                                                                                                                                                                                                      | 38       | 14    |
| Metalayer | BlockHeightReader.sol and BlockHeightProvider.sol, in the `@metalayer/contracts` npm package                                                                                                                                                                                                                                                   | 67       | 9     |
| Polymer   | [StateSyncV2.sol](https://github.com/dpbmaverick98/polymer-state-sync/blob/e277c1ec466acfc028d2e99f1adf028a44f4a06c/contracts/StateSyncV2.sol), the State Sync example [Polymer's quickstart](https://github.com/polymerdao/developer-hub/blob/dc3ca3aec2a93b4a0cc933acaad07cd3a8105078/docs/build/get%20started/quickstart.mdx) walks through | 145      | 44    |

The counts are code lines, comments and blank lines left out, and the Solidity is the example's file
alone, not the base contract it inherits (Hyperlane's Router, LayerZero's OApp). The originals'
variables become slots of the Pot's storage, each named for its variable; their events are logged
with the same signatures and topics; and the Pot pays each bridge's fee from what it holds, where
the originals take it with the call.

**Hyperlane's Hello World** counts each message sent and received, per chain, and logs both ends.
Run it with `sauce run hello-world.sauce.ts --chain ethereum --wallet <name> --args 'Hello, Base'`:

```js
function main(message: string) {
  const origin = chainId;
  const sent = crypto.keccak256("helloworld.sent");
  const sentTo = crypto.keccak256(abi.encode(Base, crypto.keccak256("helloworld.sentTo")));
  evm.sstore(sent, evm.sload(sent) + 1);
  evm.sstore(sentTo, evm.sload(sentTo) + 1);
  Base.remote(
    () => {
      const received = crypto.keccak256("helloworld.received");
      const receivedFrom = crypto.keccak256(
        abi.encode(origin, crypto.keccak256("helloworld.receivedFrom")),
      );
      evm.sstore(received, evm.sload(received) + 1);
      evm.sstore(receivedFrom, evm.sload(receivedFrom) + 1);
      log(
        abi.encode(ctx.self(), message),
        crypto.keccak256("ReceivedHelloWorld(uint32,uint32,bytes32,string)"),
        origin,
        chainId,
      );
    },
    { via: "hyperlane" },
  );
  log(abi.encode(message), crypto.keccak256("SentHelloWorld(uint32,uint32,string)"), origin, Base);
}
```

**LayerZero's OApp example** sends a string, and the chain it reaches keeps the last one it
received: here its length at `keccak256("myoapp.lastMessage")` and its bytes a word to a slot from
that slot's hash on. Run it with
`sauce run my-oapp.sauce.ts --chain ethereum --wallet <name> --args 'Hello from Ethereum'`:

```js
function main(text: string) {
  Base.remote(
    () => {
      const lastMessage = crypto.keccak256("myoapp.lastMessage");
      const words = crypto.keccak256(lastMessage.toBytesBe(32));
      // As the original encodes it: an offset, the length, then the bytes padded to whole words.
      const encoded = abi.encode(text);
      evm.sstore(lastMessage, text.length);
      for (let i = 0; i < text.length; i += 32) {
        evm.sstore(words + i / 32, encoded.slice(64 + i, 96 + i).toBe());
      }
    },
    { via: "layerzero" },
  );
}
```

**Metalayer's block-height reader** learns another chain's block height and logs it. The original
reads through Metalayer's read operations, which Metalayer's relayer performs; a remote message
sends none, so the body reads Base's block number itself, and the answer comes back as a second
message. Run it with `sauce run block-height.sauce.ts --chain ethereum --wallet <name>`:

```js
function main() {
  Base.remote(() => ctx.blockNumber(), { via: "metalayer" }).then((result) => {
    const [blockHeight] = abi.decode(result, ["Uint256"]);
    log(
      abi.encode(Base, ctx.self(), blockHeight),
      crypto.keccak256("BlockHeightReceived(uint32,address,uint256)"),
    );
  });
}
```

**Polymer's State Sync** keeps a key-value store the same on several chains: each write takes a
version one past the key's last, and a chain takes a value only when its version is newer than the
one it holds. The body runs on Base once anyone submits Polymer's proof of the message, and each
further chain is one more `remote`. The original's per-key owners and its replay check fall away:
only the owner's programs write to the Pot, and a proof delivers once. Run it with
`sauce run state-sync.sauce.ts --chain ethereum --wallet <name> --args greeting 0x68656c6c6f`:

```js
function keep(slot: Uint256, data: bytes): void {
  const words = crypto.keccak256(slot.toBytesBe(32));
  // An offset, the length, then the bytes padded to whole words.
  const encoded = abi.encode(data);
  evm.sstore(slot, data.length);
  for (let i = 0; i < data.length; i += 32) {
    evm.sstore(words + i / 32, encoded.slice(64 + i, 96 + i).toBe());
  }
}

function update(hashedKey: Uint256, value: bytes, version: Uint256): void {
  const versionOf = crypto.keccak256(
    abi.encode(hashedKey, crypto.keccak256("statesync.keyVersions")),
  );
  require(version > evm.sload(versionOf), "Version must be newer than current version");
  evm.sstore(versionOf, version);
  keep(crypto.keccak256(abi.encode(hashedKey, crypto.keccak256("statesync.store"))), value);
}

function main(key: string, value: bytes) {
  const hashedKey = crypto.keccak256(ctx.self().toBytesBe(20).concat(key));
  const versionOf = crypto.keccak256(
    abi.encode(hashedKey, crypto.keccak256("statesync.keyVersions")),
  );
  const nonces = crypto.keccak256("statesync.nonces");
  const nonce = evm.sload(nonces);
  const version = evm.sload(versionOf) + 1;
  evm.sstore(nonces, nonce + 1);
  update(hashedKey, value, version);
  log(
    abi.encode(key, value, nonce, version),
    crypto.keccak256("ValueSet(address,string,bytes,uint256,bytes32,uint256)"),
    ctx.self(),
    hashedKey,
  );
  Base.remote(
    () => {
      update(hashedKey, value, version);
      log(
        abi.encode(value, version),
        crypto.keccak256("ValueUpdated(bytes32,bytes,uint256)"),
        hashedKey,
      );
    },
    { via: "polymer" },
  );
}
```
