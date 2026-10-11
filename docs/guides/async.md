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
