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
import { Request, promiseKey } from "@sauce/async";

class EchoProtocol {
  request(protocol, value) {
    return new Request({
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

The package lists its handlers in its `package.json`. Each is a program
`main(caller: Address, value: Uint256, data: bytes)`, compiled for the Pot's chain:

```json
{
  "handlers": [{ "selector": "echo(uint256,uint256)", "program": "echo.handler.js" }],
  "interfaces": []
}
```

```js
import { fulfil, promiseKey, requireCaller } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): void {
  requireCaller(Echo, caller); // the protocol's contract, as the chain names it
  const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
  fulfil(promiseKey(7, id), abi.encode(echoed));
}
```

A declaration's `requires` lists the contracts it needs (`Namespace.Contract`), so a chain without
one skips that handler. `interfaces` lists the ERC-165 ids the Pot declares, for a protocol that
checks its receiver before it calls back.

| `@sauce/async`                                                                       | Does                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `fulfil(key, value)`, `reject(key, reason)`                                          | Settle a promise and run its body or its `.catch`; a settled key, nothing. |
| `settleCarried(key, stored, program, value, ok)`                                     | The same, for a protocol that carried the body back.                       |
| `promiseKey(tag, id)`                                                                | A protocol's id as a promise's key.                                        |
| `requireCaller(expected, actual)`, `requireSelf(sender)`                             | A handler's checks: the protocol called; this Pot sent the message.        |
| `expire(key)`                                                                        | Reject a promise past its deadline with `Timeout(bytes32)`.                |
| `install(selector, program, readOnly)`, `declareInterface(id, supported)`            | What installing a package's handlers calls.                                |
| `received()`, `fulfilled()`                                                          | In a running body: what settled it, and how.                               |
| `park`, `run`, `salt`, `isPending`                                                   | The settlement table's parts, for a package that needs them directly.      |
| `Erc1271.approve(hash)`, `Erc1271.revoke(hash)`, `isValidSignature(hash, signature)` | The Pot as an ERC-1271 signer (above).                                     |

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
