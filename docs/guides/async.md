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

## Randomness

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
```

| Request                                     | The body receives                     | Defaults                                              |
| ------------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `Random.vrf({ words, confirmations, gas })` | `words` random numbers, a `Uint256[]` | 1 word, 3 confirmations, `gas` sized from the body    |
| `Random.entropy({ provider, gas })`         | one random 32-byte number             | Entropy's default provider, `gas` sized from the body |

- **The Pot pays twice.** The request pays the provider's price in the native coin from the Pot's
  balance when the program runs: VRF's wrapper price at the transaction's gas price, or Entropy's
  fee. Exactly the price is paid, since both providers keep any excess. The callback's cook then
  pays the Kitchen's fee.
- **`gas` is the callback's gas limit,** fixed and paid for with the request. Left out, the package
  sizes it from the body as compiled: what reaching the body costs, about 100,000 gas, plus an
  allowance for each byte of the body. That covers writes, hashing and a few token transfers; a
  body that loops, or calls out more than its size suggests, needs `gas` given.
- **A callback that fails** is final with VRF: the wrapper gives the callback exactly `gas`, and a
  callback that reverts or runs out is spent, paid for and never retried. Pyth Entropy keeps the
  request open, and anyone may reveal it again.
- **The body reads numbers, addresses and booleans** from the program around it, not arrays: choose
  among fixed parameters, as the coin flip does.
- **Requests are keyed by the provider's own id.** VRF's request id, bound to the wrapper, and
  Entropy's sequence number, bound to the Entropy contract and its provider, since sequence numbers
  count per provider.

Install the handlers, which answer `rawFulfillRandomWords` from the chain's VRF wrapper and
`_entropyCallback` from its Entropy contract, once per Pot. On a chain with one provider, only its
handler installs:

```sh
sauce run @sauce/random --chain base --wallet <name>
```
