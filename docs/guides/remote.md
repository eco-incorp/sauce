# Remote messages

[Documentation](../README.md) · [Create an intent](intents.md) · [Protocols](../reference/protocols.md)

A Private Pot has the same address on every chain its owner mints it on. A program cooked on one of
them can send a program to itself on another chain, over a bridge, and that Pot runs it when the
bridge delivers it. Nothing moves with the message, and the program runs as the owner's own Pot,
whose storage and balances stay between messages. That is the
difference from an intent, whose body runs on a Pot every intent to that chain shares.

`@sauce/remote` sends over the four bridges eco-routes proves intents with: Hyperlane, LayerZero
V2, Metalayer and Polymer. In a program it is a method of every chain's name:

```js
function main(value: Uint256) {
  Base.remote(() => {
    // Runs on Base, as this same Pot, when the bridge delivers it.
    evm.sstore(1, value);
  });
}
```

The body is compiled for Base, with Base's names: a token symbol in it is Base's token. What it
reads of `main`, `value` here, travels with it. The examples use Ethereum and Base, two of the
chains the release supports ([Chains](../reference/chains.md)).

## Get an answer back

With `.then`, what the body returns comes back to the chain that sent it:

```js
function main(bump: Uint256) {
  Base.remote(() => {
    return USDC.balanceOf(self); // Base's USDC, held by this Pot on Base
  }).then((result) => {
    // Back on Ethereum: `result` is the bytes the body answered, one word here.
    const [balance] = abi.decode(result, ["Uint256"]);
    evm.sstore(2, balance + bump);
  });
}
```

`await` is `.then` with the code after it: `await Base.remote(() => { … });` runs the rest of
`main` back here once the body ran on Base. `.catch((e) => { … })` runs back here when the body
reverts there, with what it reverted with (at most its first 256 bytes), and the body's work undone.

A round trip is two messages: the `.then` is compiled for this chain while the program compiles,
travels to Base inside the first message, and comes back inside the second, with the body's
answer. Nothing waits on either Pot in between.

## Install the handlers on each Pot

A bridge delivers a message by calling the Pot with its own callback. A Private Pot answers a
call it was not written for with the program its owner registered for that selector, which its
Router runs. Install `@sauce/remote`'s once on each chain the Pot sends to or hears from:

```sh
sauce run @sauce/remote --chain ethereum --wallet <name>
sauce run @sauce/remote --chain base --wallet <name>
```

| Bridge    | The Pot answers                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Hyperlane | `handle(uint32,bytes32,bytes)`, from the chain's Mailbox                                             |
| Metalayer | `handle(uint32,bytes32,bytes,(uint32,address,bytes)[],bytes[])`, from the chain's MetalayerRouter    |
| LayerZero | `lzReceive(...)`, from the chain's EndpointV2, and, read-only, `allowInitializePath` and `nextNonce` |
| Polymer   | `deliver(bytes proof)`, from anyone                                                                  |

Each handler checks that its caller is the bridge's contract on that chain, and that the message's
sender on its origin chain is this same Pot, before it runs anything. A Polymer proof is checked by
Polymer's prover there, must be of a log this Pot emitted for this chain, and runs once. A Shared
Pot answers no such call, so remote messages run on a Private Pot only.

## Choose the bridge

A message takes the first of Hyperlane, LayerZero, Metalayer and Polymer that both chains have.
Name one with `via`, and the gas the destination's handler is given with `gas` (and `replyGas` for
the way back):

```js
Base.remote(
  () => {
    evm.sstore(1, 1);
  },
  { via: "layerzero", gas: 400000 },
);
```

Hyperlane, LayerZero and Metalayer relay a paid message on their own. Polymer relays nothing: the
sending Pot emits a log, and someone fetches its proof from Polymer's prove API and calls the
destination Pot's `deliver(bytes proof)`, paying that transaction's gas. Each bridge's deployments
are in [Protocols](../reference/protocols.md).

## What a message costs, and where

Each leg is paid on the chain it leaves, from that chain's Pot: the sending Pot pays the bridge's
fee, which the program reads from the bridge when it sends, so it holds the chain's native coin.
The receiving Pot pays the Kitchen's fee for every message its handler runs, and on a round trip
the bridge's fee for the way back. Fund both Pots before you send.

## With an intent

An intent moves money; a remote message does the stateful part on the Pot that owns it. They
arrive in no set order, so the body checks what it needs, and a body that reverts leaves the
message undelivered, to be delivered again once it is there:

```js
function main(amount: Uint256, owner: Address) {
  const pot = ctx.self(); // this Pot's address, the same on Base
  await Base.hop({
    send: { token: USDC, amount: amount + amount / 100 },
    receive: { token: USDC, amount },
    refundee: owner,
  });
  USDC.transfer(pot, amount); // on Base, from the intent's Pot to this one
}
```

and, in the same program or another:

```js
function main(amount: Uint256) {
  Base.remote(() => {
    require(USDC.balanceOf(self) >= amount, "not arrived yet");
    USDC.approve(AaveV3.Pool, amount);
    AaveV3.Pool.supply(USDC, amount, self, 0);
  });
}
```
