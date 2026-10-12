---
name: sauce-async
description: Promises in a Sauce program with @sauce/async — a request whose answer arrives later, in a transaction of its own, its .then body compiled with the program and run when the protocol calls the Pot back, as the same Private Pot. Covers .then and .catch on a request; Promise.all, race, any, allSettled, resolve, reject and withResolvers with JavaScript's semantics; deadlines, Async.timeout and the public expire(key) anyone may call after one; settling a promise by its key in a later transaction (Async.resolve, Async.reject); the handlers a request installs on the Pot as it runs, with nothing to install first; and writing a package of the family (Request, its handlers, a handler that settles by key, the optional pre-install with sauce run @sauce/<package>). Use when a program must wait for randomness, an oracle, a cross-chain message or a proof, when the user mentions a callback, a promise, then, a timeout or a deadline, or when writing a protocol package with a callback.
---

# Promises with `@sauce/async`

Some protocols answer later, in a transaction of their own: a random number, an oracle's report, a
message from another chain, a proof. In Sauce a program asks now, and the code that uses the answer
is the request's `.then` body. The request is a **promise**: it
settles exactly once, fulfilled with a value or rejected with a reason. Its body is compiled with
the program and runs when the protocol calls the Pot back, as the same Pot, in the callback's
transaction.

A protocol's package gives the program a request method; this one asks `protocol` to echo
`value`, and its promise is keyed by the id the request answers:

```sauce chain=base
import { Request, promiseKey } from "@sauce/async";

class EchoProtocol {
  request(protocol: Address, value: Uint256) {
    return new Request({
      send: (continuation) => {
        const asked = evm.call(protocol, 0, hex`d845a4b3`.concat(abi.encode(value)));
        return promiseKey(7, abi.decode(asked, ["Uint256"])[0]);
      },
      deliver: (input, body, fail) => {
        body(abi.decode(input, ["Uint256"])[0]);
      },
    });
  }
}
const Echo = new EchoProtocol();

function main(protocol: Address, value: Uint256, recipient: Address) {
  Echo.request(protocol, value)
    .within(3600)
    .then((echoed) => {
      USDC.transfer(recipient, echoed);
    })
    .catch((e) => {
      USDC.transfer(recipient, value);
    });
}
```

## Where a callback lands

- **A Private Pot.** The protocol calls the Pot with a selector of its own. The Pot's Router runs
  the program registered for that selector, the handler, which checks the call came from the
  protocol and settles the promise the callback names. The request installs the handlers its
  callback needs as it runs, in the same transaction, and with a deadline the Pot's public
  `expire(bytes32)` too; a later request finds them in place and only checks them. There is nothing
  to install first. A Shared Pot, and a Private Pot whose Router is fixed, answer no callback.
- **The native coin for the fee.** Each callback is a cook of the Pot, and the Router pays the
  Kitchen's fee from the Pot's own balance.

## What the body sees

- **The program around it, as it was at the request.** Every value the body reads from the program
  is carried into it when the request is made, and the body cannot assign it. What the protocol
  delivers is the body's parameter, decoded by the package.
- **One settlement.** A promise settles once. A second callback for it, or a late one after it
  settled, runs nothing and returns, so the protocol's transaction never fails for it. A call from
  anyone but the protocol is refused.
- **`.catch` in its place.** `.catch((e) => { … })` runs when the promise is rejected (the protocol
  reported a failure, or the deadline passed) and when the body reverts, everything the body did
  undone; `e` is what it reverted with, its first 256 bytes. With no `.catch`, a rejection is logged
  and the callback still returns.
- **A value comes only as `.then`'s parameter**: there is no `await`, so the code that uses the
  answer is the body, and `Promise.all([a, b]).then((r) => { … })` joins several.

## Promise's combinators

`Promise.all`, `race`, `any` and `allSettled` take a list of promises and settle as JavaScript's do,
each child decoded by its own package:

| Combinator                   | Settles                                                        | Its body is handed                                    |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| `Promise.all([a, b])`        | when every child is fulfilled; rejected by the first rejection | `r`, each child's value in order: `r[0]`, `r[1]`      |
| `Promise.race([a, b])`       | as the first child to settle does                              | that child's value                                    |
| `Promise.any([a, b])`        | by the first fulfilment; rejected when every child is          | that child's value                                    |
| `Promise.allSettled([a, b])` | when every child has settled                                   | `r[i].status` (2 fulfilled, 3 rejected), `r[i].value` |

A child that settles after its combinator has runs nothing. `Promise.resolve(word)` and
`Promise.reject(reason)` are settled already, and compose with the others.

## Deadlines, timeouts and deferreds

- **A deadline**: `.within(seconds)` on a request, or a `deadline` its package sets. After it,
  anyone may call the Pot's `expire(bytes32 key)`, which rejects the promise with
  `Timeout(bytes32 key)`. The caller pays at least the Kitchen's fee as the call's value: every
  handler's cook is paid from the Pot's balance, so one anyone could call for free would drain it.
- **A timeout**: `Async.timeout(seconds)` is a promise that only times out, for
  `Promise.race([request, Async.timeout(3600)])`.
- **A deferred**: `Promise.withResolvers()` is a promise the program settles itself, later:
  `const { promise, key } = Promise.withResolvers()`. The Pot logs its key,
  `PromisePending(bytes32 key, uint256 deadline)`, when its body is parked; a later cook of the
  owner settles it: `Async.resolve(key, value)` or `Async.reject(key, reason)`. Its body is handed
  the value as bytes.

[`examples/approval.sauce.ts`](examples/approval.sauce.ts) pays once the owner approves, within a
day: a deferred raced against a timeout. [`examples/approve.sauce.ts`](examples/approve.sauce.ts) is
the owner's later cook that resolves it by its key.

## Writing a package

A package's request returns `new Request({ send, deliver, handlers, interfaces, carries, chain,
deadline })`, from a
method on an object the program reads (the echo protocol's `request` above) or a plain function; or
it is a class that extends `Request` and hands `super` the same options. The three compile to the
same program:

- `send(continuation)` makes the request when the statement ends and answers the promise's key,
  `promiseKey(tag, id)`: the protocol's id under a word naming the protocol.
- `deliver(input, body, fail)` runs when the promise is fulfilled: it decodes what arrived and calls
  `body(value)`, or `fail(reason)` when the protocol reports a failure.
- `handlers` are the handlers the protocol's callback reaches (below), installed on the Pot as the
  request runs, unless they already are; `interfaces` the ERC-165 ids a protocol checks the Pot
  for before it calls back, declared the same way.
- `carries: true` is for a protocol that carries the requester's bytes back (a bridge's message, a
  proof's extra data): the key is picked first, and `send` is handed `{ key, stored, program }`. A
  plain `.then` stores nothing: the message carries `program`. With a deadline or a combinator,
  `stored` is true and the message carries only `key`.
- `chain` is the chain the callback lands on (`Optimism`, or its id), which the body is compiled
  for: this chain by default.

```sauce chain=base
import { Request, promiseKey } from "@sauce/async";

class Echo extends Request {
  constructor(protocol: Address, value: Uint256) {
    super({
      send: (continuation) => {
        const asked = evm.call(protocol, 0, hex`d845a4b3`.concat(abi.encode(value)));
        return promiseKey(7, abi.decode(asked, ["Uint256"])[0]);
      },
      deliver: (input, body, fail) => {
        body(abi.decode(input, ["Uint256"])[0]);
      },
    });
  }
}

function main(protocol: Address, value: Uint256, recipient: Address) {
  new Echo(protocol, value).then((echoed) => {
    USDC.transfer(recipient, echoed);
  });
}
```

Its handlers go in the request's `handlers`: each a `Handler`, the program the Router runs when the
protocol calls the Pot with that selector, handed the caller, the value it sent and the whole
calldata. The request installs each on the Pot as it runs, unless the Pot already answers the
selector with it:

```js
new Request({
  handlers: [
    new Handler(ECHO_SELECTOR, (caller: Address, value: Uint256, data: bytes) => {
      requireCaller(Protocol, caller);
      const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
      fulfil(promiseKey(7, id), abi.encode(echoed));
    }),
  ],
  send: (continuation) => { … },
});
```

A handler captures nothing of the program around it, since it runs on its own whenever the selector
reaches the Pot: the protocol it checks is a name the chain declares, never a value of the request.
It checks its caller with `requireCaller(protocol, caller)`, then settles:
`fulfil(promiseKey(tag, id), abi.encode(value))` or `reject(key, reason)`, and for a protocol that
carries its bytes, `requireSelf(sender)` then `settleCarried(key, stored, program, value, ok)`. A
third argument `true` makes it a view (static, no fee), as a signature check must be;
`Erc1271.handler()` is the Pot's ERC-1271 handler, for a package whose protocol asks the Pot to
sign.

The package also lists its handlers in its `package.json` (`"handlers"`: selector, program file,
`requires`; `"interfaces"`: ERC-165 ids), for `sauce run @sauce/<package>`, which installs them on a
Pot ahead of its first request so that request does not pay for them. That is optional.

## The Pot as a signer

A Pot answers ERC-1271's `isValidSignature(bytes32 hash, bytes signature)` with one handler the
core ships, which a package that needs the Pot to sign declares as its own handler
(`"program": "@sauce/async/erc1271.handler.js"`, a view). It is valid for:

- **a hash the Pot approved**: `Erc1271.approve(hash)` in a program running as the Pot (and
  `Erc1271.revoke(hash)`), whatever the signature bytes, since the approval is the authorization:
  a request the Pot made, which a market checks before it spends the Pot's deposit. One storage read, well under the 100,000 gas such a check gives it;
- **the owner's signature over the hash bound to the Pot**: EIP-712's `PotMessage { hash: bytes32 }`
  under the domain `{ name: "Sauce Pot", version: "1", chainId, verifyingContract: the Pot }`, never
  the bare hash, so a signature the owner made for anything else is none of the Pot's. A malleable
  signature is refused; an owner that is a contract is asked ERC-1271 itself.

## What it costs

A request parks one word, beside up to three words its body captured (more go into code), and its
body's code is deployed once per Pot and shared by every request that compiles to it. A carried
`.then` stores nothing. Each callback is a cook: the Kitchen's fee, and the handler's settlement. A
combinator parks its own word and one per child, and keeps each child's value until the last.
