# Waiting for a callback

[Documentation](../README.md) · [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md)

Some protocols answer later, in a transaction of their own: a random number, an oracle's response,
a message from another chain, a proof. In Sauce a program asks now, and the code that uses the
answer is the request's `.then` body, or what follows an `await` of it. The body is compiled with
the program. It runs when the protocol calls the Pot back, as the same Pot, in the callback's
transaction.

```js
await Random.vrf({ words: 2 }).then((words) => {
  USDC.transfer(players[words[0] % 2], prize);
});
```

`Random.vrf` stands for a protocol's package. Every such package is built on `@sauce/async`, the
library this page describes, which the SDK resolves with no install.

## What a callback needs

- **A Private Pot with the package's handlers installed.** The protocol calls the Pot with a
  selector of its own. The Pot's Router answers it with the program its owner registered for that
  selector: the handler, which checks the call came from the protocol, takes the parked body and
  runs it. A Shared Pot answers no callback.
- **The native coin for the fee.** Each callback is a cook, and the Router pays the Kitchen's fee
  from the Pot's own balance.

Install a package's handlers once per Pot by giving the package where a program file goes:

```sh
sauce run @sauce/<package> --chain base --wallet <name>
```

`sauce compile`, `sauce tx` and `sauce simulate` take the package the same way: one cook, an
`install` for each selector the package answers. From TypeScript, `routes.packageHandlers(chain,
specifier)` compiles a package's handlers for a chain, and `routes.handlersInstallSource(handlers)`
writes the program that installs them.

## What the body sees

- **The program around it, as it was at the request.** Every value the body reads from the program
  is carried into it when the request is made, and the body cannot assign it. What the protocol
  delivers arrives as the body's parameters, decoded by the package.
- **One run per answer.** The body is taken when it runs. The same answer delivered again is
  refused, and so is a call from anyone but the protocol.
- **`.catch` in its place.** `.catch((e) => { … })` runs instead when the body reverts, with
  everything the body did undone, or when the protocol reports that the request failed, handed why.
  With no `.catch`, the callback reverts and the body stays parked.

## An oracle's answer: `@sauce/oracle`

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
- **Installing** `@sauce/oracle` on a Pot registers the `onReport` handler and declares the Pot an
  `IReceiver`, which the forwarder checks over ERC-165 before each delivery. It runs on Ethereum
  and Base.
- **The delivery's gas is the workflow's.** The forwarder runs the body in the report's
  transaction: about 250,000 gas for a short body, plus what the body spends, in the workflow's
  report write.

Chainlink Functions, the request-and-callback product CRE replaces, no longer answers on mainnet:
its routers still accept a request, and the LINK it holds stays locked until the request times
out.

## Writing a package

A package's request is a method on an object the program reads, returning a `Request` from
`@sauce/async`:

```js
import { Request } from "@sauce/async";

class EchoProtocol {
  request(protocol, value) {
    return new Request({
      // At run time, when the statement ends: make the request, and answer the key the body is
      // parked under (the protocol's request id).
      send: (continuation) => {
        const asked = evm.call(protocol, 0, hex`d845a4b3`.concat(abi.encode(value))); // request(uint256)
        return abi.decode(asked, ["Uint256"])[0];
      },
      // In the body's program, when the callback lands: decode what arrived into the body's
      // parameters, or report the request failed.
      deliver: (input, body, fail) => body(abi.decode(input, ["Uint256"])[0]),
    });
  }
}
```

The request runs first and parks the body second, so the callback has to come in a later
transaction. A protocol that carries data back to the Pot, such as a bridge's message, can carry
the body itself: `send` puts `continuation.code.concat(continuation.args)` in the message and
answers `undefined`, and the handler checks with `requireSelf` that this Pot sent it.

The package declares its handlers in its `package.json`:

```json
{
  "handlers": [
    { "selector": "echo(uint256,uint256)", "program": "echo.handler.js", "readOnly": false }
  ]
}
```

Each handler is a program `main(caller: Address, value: Uint256, data: bytes)`, compiled for the
Pot's chain:

```js
import { requireCaller, run, take } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): bytes {
  requireCaller(Echo, caller); // the protocol's contract, as the chain names it
  const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
  return run(take(id), abi.encode(echoed));
}
```

A handler marked `readOnly` runs under a static call with no fee: a view the protocol asks the Pot.

| `@sauce/async`                         | Does                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `park(key, program)`                   | Stores a body under a key, deployed as a contract's code. A key parks once.     |
| `take(key)`                            | Returns the body parked under a key and clears it. Refused when none is parked. |
| `run(program, input)`                  | Runs a body as this Pot, in the handler's cook, handing it `input`.             |
| `received()`                           | In a running body: the `input` it was handed.                                   |
| `requireCaller(expected, actual)`      | The handler's check that the protocol called.                                   |
| `requireSelf(sender)`                  | The handler's check that a message came from this Pot.                          |
| `install(selector, program, readOnly)` | Registers a handler on this Pot, from a cooked program.                         |
