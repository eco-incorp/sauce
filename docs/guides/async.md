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
  `.catch` runs, and `Zk.cancel(e)` there cancels the query and takes its payment back.
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
  request if a prover locked it and failed, and withdraws its price.

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
