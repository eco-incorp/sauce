---
name: sauce-remote
description: Remote messages written in Sauce — a program that runs code on your own Private Pot on another chain, Base.remote(() => { … }) in main, the body compiled for that chain and run there as the same Pot when a bridge delivers it; a round trip as a promise, .then((result) => { … }) back here with what the body returned, .catch((e) => { … }) with what it reverted with there, .within, Promise.all and race over several chains; the bridge (Hyperlane, LayerZero, Metalayer or Polymer, the first both chains have, or via) and each leg's gas; which Pot pays what; the handlers both Pots install with sauce run @sauce/remote and what each checks; Polymer proofs anyone submits; a message that waits for money an intent brings. Use when a program should run code on the same Pot on another chain, read or change its state there, get an answer back from one or several chains, or when the user mentions remote messages, cross-chain calls or messaging, Hyperlane, LayerZero, Metalayer or Polymer.
---

# Remote messages in Sauce

A Private Pot has the same address on every chain its owner minted it on. A program cooked on one
of them can send a program to that same Pot on another chain, over a bridge, and the Pot there runs
it when the bridge delivers it, as itself, with the storage and balances it holds there. Nothing is
escrowed and no solver is paid: the bridge carries the message for a fee.

That is what sets it apart from an intent (`sauce-intents`), whose body runs on the destination's
**shared** Pot, keeps nothing between fills, and is run by a solver for a reward. Send a remote
message to change or read your own Pot's state on another chain; open an intent to have money
brought there. They combine: below.

```sauce chain=ethereum,base
function main(value: Uint256) {
  Optimism.remote(() => {
    // Runs on Optimism, as this same Pot, when the bridge delivers it.
    evm.sstore(crypto.keccak256("remote.value"), value);
  });
}
```

`<Chain>.remote(body)` is a method of every chain's name. The body is compiled for that chain, with
its names: a token symbol in it is that chain's token, `self` that chain's Pot. What it reads of
`main` (`value` above) is carried in with it, as it was when the message was sent, and it cannot
assign it. Every input is one of `main`'s typed parameters, passed with `--args` (`sauce-script`).

## Get the answer back

A round trip is a **promise** (`sauce-async`): it settles once, fulfilled with what the body
returned or rejected with what it reverted with.

```sauce chain=ethereum
function main(bump: Uint256) {
  Base.remote(() => {
    return USDC.balanceOf(self); // Base's USDC, held by this Pot on Base
  })
    .then((result) => {
      // Back on Ethereum: what the body returned, as the bytes its program answered.
      const [balance] = abi.decode(result, ["Uint256"]);
      evm.sstore(crypto.keccak256("base.usdc"), balance + bump);
    })
    .catch((e) => {
      // Back on Ethereum: the body reverted on Base, and everything it did there is undone.
      evm.sstore(crypto.keccak256("base.failed"), crypto.keccak256(e));
    });
}
```

- **`.then((result) => { … })`** runs back here once the body ran there. `result` is what the body
  returned, as bytes: one word for a number (decode it as above), the bytes themselves for bytes,
  nothing for a body that returns nothing.
- **`.catch((e) => { … })`** runs back here when the body reverts there, handed what it reverted
  with (at most its first 256 bytes), everything the body did there undone; and here, in place of
  the `.then`, when that reverts.
- **Code that should run back here once the body ran there** goes in a `.then(() => { … })` that
  names no parameter; SauceScript has no `await`.
- **With no `.catch`**, a body that reverts there still rejects the promise: nothing runs back
  here, and the rejection is logged as unhandled. The message is delivered once either way.
- **With no `.then` or `.catch` at all**, a message is one way and nothing comes back. Its body
  runs uncaught: a revert reverts the delivery, the message stays undelivered, and the bridge can
  deliver it again, when it may succeed. A body that waits for something (money an intent brings)
  is a one-way message.

Each way is a message of its own, paid on the chain it leaves. A plain round trip stores nothing:
the `.then` and the `.catch` are compiled for this chain while the program compiles, and travel
there and back inside the messages.

## Several chains, and deadlines

A remote message is a promise among others, so `@sauce/async`'s combinators take it:

```sauce chain=ethereum
import { Promise } from "@sauce/async";

function main(bump: Uint256) {
  Promise.all([
    Base.remote(() => {
      return USDC.balanceOf(self);
    }),
    Optimism.remote(() => {
      return USDC.balanceOf(self);
    }),
  ]).then((r) => {
    // Back on Ethereum, once both answered: each answer in the order listed.
    const [onBase] = abi.decode(r[0], ["Uint256"]);
    const [onOptimism] = abi.decode(r[1], ["Uint256"]);
    evm.sstore(crypto.keccak256("usdc.elsewhere"), onBase + onOptimism + bump);
  });
}
```

- **`Promise.race`** takes the first answer; a later one is delivered and changes nothing.
  `Promise.any` and `Promise.allSettled` work the same way.
- **`.within(seconds)`** gives the answer a deadline: after it, anyone may call this Pot's
  `expire(bytes32 key)`, paying the Kitchen's fee, which rejects the promise into its `.catch`, and
  an answer that comes later is ignored.
- A deadline or a combinator keeps the promise in this Pot's storage until it settles
  (`sauce-async`), so a late or second answer is ignored.

## Choose the bridge

A message takes the first of **Hyperlane, LayerZero, Metalayer and Polymer** that both chains
have; each chain's file in `sauce-chains` lists its protocols. Name one with `via`. `gas` is the gas
the destination Pot's handler is given, and `replyGas` the same for the way back (each 500,000 when
left out):

```sauce chain=ethereum
function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(crypto.keccak256("remote.value"), value);
  }, { via: "layerzero", gas: 400000 });
}
```

- **Hyperlane, LayerZero and Metalayer** relay a message whose fee was paid: their relayers carry it
  and call the destination Pot. The fee pays for the `gas` named, so too little gas leaves the
  message undelivered until someone delivers it with more.
- **Polymer** relays nothing. The sending Pot emits a RemoteMessage log, naming the chain whose Pot
  may run it and holding the message, and nothing is paid on the source. Someone fetches the log's proof
  from Polymer's prove API and calls the destination Pot's `deliver(bytes proof)`, paying that
  transaction's gas.
- A bridge one chain lacks is a compile error naming the chain, and so is a chain with no bridge to
  this one.

## What a message costs, and which Pot pays

- **The sending Pot pays the bridge**, in its chain's native coin: the program reads the fee from
  the bridge as it sends, and pays it from the Pot's balance. Fund the Pot, or send value with the
  cook.
- **The receiving Pot pays the Kitchen's fee** for each message its handler runs (each delivery is a
  cook of that Pot), and on a round trip the bridge's fee for the way back. Fund it before the
  message arrives.

Gas, measured on local chains through the engine and Kitchen-made Pots, over Hyperlane's own
Mailbox with stand-ins for its hooks and an interchain security module that checks nothing: on a
live chain its hooks add to the send, and its checks to each delivery, which the relayer pays:

| What                                                     | Gas, about |
| -------------------------------------------------------- | ---------- |
| The cook that sends a message                            | 220,000    |
| Delivering a one-way message whose body writes one word  | 170,000    |
| The far leg of a round trip: the body, and sending back  | 405,000    |
| The same with a `.catch`, the body run caught            | 430,000    |
| Delivering the answer back, the `.then` writing one word | 200,000    |

`gas` is what the destination's handler is given out of that; 500,000 covers these bodies, and a
body that does more needs more.

## Install the handlers on both Pots

A bridge delivers a message by calling the Pot with its own callback. A Private Pot answers a call
it was not written for with the program its owner installed for that selector. Install
`@sauce/remote`'s once on each chain the Pot sends to or hears from, giving the package as the
program:

```sh
sauce run @sauce/remote --chain base --wallet <name>
```

| Bridge    | The Pot answers                                                             | From                    |
| --------- | --------------------------------------------------------------------------- | ----------------------- |
| Hyperlane | `handle(uint32,bytes32,bytes)`                                              | the chain's Mailbox     |
| Metalayer | `handle(uint32,bytes32,bytes,(uint32,address,bytes)[],bytes[])`             | the chain's router      |
| LayerZero | `lzReceive((uint32,bytes32,uint64),bytes32,bytes,address,bytes)`            | the chain's EndpointV2  |
| LayerZero | `allowInitializePath((uint32,bytes32,uint64))`, `nextNonce(uint32,bytes32)` | the endpoint, read-only |
| Polymer   | `deliver(bytes proof)`                                                      | anyone                  |

Each handler checks that the call came from the bridge's contract on that chain, and that the
message's sender on its origin chain is this same Pot, before it runs anything. A Polymer proof is
checked by Polymer's contract on that chain (`Polymer.CrossL2ProverV2`), must prove a log this Pot
emitted for this chain, and runs once. LayerZero's two read-only answers run with no fee: a path to the Pot opens only from the
Pot itself, and messages arrive in any order. A shared Pot answers no message, so a remote message
runs between Private Pots only.

## With an intent

An intent brings the money; a remote message does the stateful part on your Pot. They arrive in no
set order, so a one-way message's body checks what it needs: until it is there the body reverts,
the message stays undelivered, and it is delivered again later. The intent's body moves what it received from the
shared Pot to yours, whose address is this one's:

```sauce chain=ethereum
function main(amount: Uint256, owner: Address) {
  const pot = ctx.self(); // this Pot, the same address on Base
  Base.hop({
    send: { token: USDC, amount: amount + amount / 100 },
    receive: { token: USDC, amount },
    refundee: owner,
  }).then(() => {
    USDC.transfer(pot, amount); // on Base, from the shared Pot to this one
  });
  Base.remote(() => {
    require(USDC.balanceOf(self) >= amount, "not arrived yet");
    USDC.approve(AaveV3.Pool, amount);
    AaveV3.Pool.supply(USDC, amount, self, 0);
  });
}
```

## Compile, send, and hand off

A file with a remote message compiles and runs like any program: `sauce compile` gives its
bytecode, `sauce tx` the cook transaction (`to` the Pot, `data`, `value`) as unsigned JSON for any
signer, and `sauce simulate` and `sauce run` rehearse and send it from the Pot (`sauce-cli`):

```sh
sauce simulate remote.sauce.ts --chain ethereum --owner <address> --args 7
sauce tx remote.sauce.ts --chain ethereum --owner <address> --args 7
```

A rehearsal shows the cook on the sending chain: the message priced and handed to the bridge. What
the body does there runs when the bridge delivers it, in a transaction of its own; rehearse the
body as a program for that chain to see it.

## The bridges' own examples, in Sauce

Each bridge's official example app, ported. The original is a contract deployed on both chains,
each set up to trust the other; the Sauce program deploys none: it runs on the owner's Pot on the
chain it is cooked on, and its body on the same Pot on the other.

| Bridge    | Official example                                    | Solidity | Sauce | Program                                                          |
| --------- | --------------------------------------------------- | -------- | ----- | ---------------------------------------------------------------- |
| Hyperlane | HelloWorld, Hyperlane's Hello World app             | 62       | 25    | [examples/hello-world.sauce.ts](examples/hello-world.sauce.ts)   |
| LayerZero | MyOApp, LayerZero's OApp example                    | 38       | 14    | [examples/my-oapp.sauce.ts](examples/my-oapp.sauce.ts)           |
| Metalayer | BlockHeightReader and BlockHeightProvider           | 67       | 9     | [examples/block-height.sauce.ts](examples/block-height.sauce.ts) |
| Polymer   | State Sync (StateSyncV2), from Polymer's quickstart | 145      | 44    | [examples/state-sync.sauce.ts](examples/state-sync.sauce.ts)     |

Lines are code lines, comments and blank lines left out, and the Solidity is the example's own file
only, not the bridge's base contract it inherits (Hyperlane's Router, LayerZero's OApp). Each
program's header cites its source and says what changed:

- **What the original keeps in variables**, the program keeps in the Pot's storage, each at a slot
  named for the variable (`keccak256("helloworld.sent")`), and its events are logged with the same
  signatures and topics.
- **The fee** the original takes with the call, the Pot pays from what it holds.
- **Metalayer's read operations** are performed by its relayer, and a remote message sends none: the
  body reads Base's block number itself, and the answer comes back as a second message.
- **State Sync's per-key owners and replay check** fall away: only the owner's programs write to
  the Pot, and a Polymer proof delivers once.

## More examples

- [examples/pay-on-base.sauce.ts](examples/pay-on-base.sauce.ts) pays someone on Base from this Pot
  there, from a program cooked on Ethereum, and records back on Ethereum what the Pot holds on Base
  afterwards.
