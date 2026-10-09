# Waiting for a callback

[Documentation](../README.md) · [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md)

Some protocols answer later, in a transaction of their own: a random number, an oracle's report, a
message from another chain, a proof. In Sauce a program asks now, and the code that uses the answer
is the request's `.then` body, or what follows an `await` of it. The request is a promise: it
settles exactly once, fulfilled with a value or rejected with a reason. The body is compiled with
the program and runs when the protocol calls the Pot back, as the same Pot.

```js
await Random.vrf({ words: 1 }).then((words) => {
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

A package's request is a method on an object the program reads, returning a `Request`:

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

| `@sauce/async`                                                            | Does                                                                       |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `fulfil(key, value)`, `reject(key, reason)`                               | Settle a promise and run its body or its `.catch`; a settled key, nothing. |
| `settleCarried(key, stored, program, value, ok)`                          | The same, for a protocol that carried the body back.                       |
| `promiseKey(tag, id)`                                                     | A protocol's id as a promise's key.                                        |
| `requireCaller(expected, actual)`, `requireSelf(sender)`                  | A handler's checks: the protocol called; this Pot sent the message.        |
| `expire(key)`                                                             | Reject a promise past its deadline with `Timeout(bytes32)`.                |
| `install(selector, program, readOnly)`, `declareInterface(id, supported)` | What installing a package's handlers calls.                                |
| `received()`, `fulfilled()`                                               | In a running body: what settled it, and how.                               |
| `park`, `run`, `salt`, `isPending`                                        | The settlement table's parts, for a package that needs them directly.      |

## Storage and cost

A pending promise is one word in the Pot's storage, in the ERC-7201 namespace
`sauce.storage.Async`: the address of its body's code, its deadline, its state and its flags. Up
to three words the body captured sit beside it, and more go into code. The body's code is deployed
once per Pot, by CREATE2 at an address its bytes decide, and shared by every request that compiles
to it. Settling clears the word. A carried `.then` stores nothing. A combinator parks a word of its
own and one per child, and keeps each child's value until it is decided.

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
  the same bridge and fulfils the promise here; when something here handles a rejection (a
  `.catch`, a deadline, a combinator), what it reverted with is sent back instead and rejects it.
  A plain `.then` with no `.catch` runs the body uncaught, so a revert there is retried.
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

Install `@sauce/remote`'s handlers on the Pot on every chain it sends to or hears from:
`sauce run @sauce/remote --chain base --wallet <name>`. A chain installs a handler for each bridge
it has:

| Bridge    | The Pot answers                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Hyperlane | `handle(uint32,bytes32,bytes)`, from the chain's Mailbox                                             |
| Metalayer | `handle(uint32,bytes32,bytes,(uint32,address,bytes)[],bytes[])`, from the chain's MetalayerRouter    |
| LayerZero | `lzReceive(...)`, from the chain's EndpointV2, and, read-only, `allowInitializePath` and `nextNonce` |
| Polymer   | `deliver(bytes proof)`, from anyone                                                                  |

Each handler checks that its caller is the bridge's contract on that chain and that the message's
sender on its origin chain is this same Pot before it runs anything. A Polymer proof is checked by
Polymer's prover on that chain, must be of a log this Pot emitted for this chain, and runs once.

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
