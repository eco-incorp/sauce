# How Sauce fits together

[Documentation](../README.md) · [Quick start](../guides/quick-start.md) · [SauceScript](saucescript.md)

Sauce turns a program into one atomic on-chain execution. Three pieces divide that work, and knowing
which piece owns a problem is most of what this page is for.

| Piece    | Where it lives                                   | What it does                                                                                                 |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| This SDK | `@eco-incorp/sauce` and its subpaths             | Chain, protocol and token knowledge; route syntax; builders; intent encoding; account planning; verification |
| Compiler | bundled, exposed at `@eco-incorp/sauce/compiler` | Checks SauceScript, resolves modules and ABIs, applies compile-time values, emits bytecode for a target      |
| Engine   | deployed on chain, with a Kitchen and Pot        | Executes that bytecode against the chain's real contracts and accounts                                       |

You only install one package. The compiler comes with it.

What the engine actually does is simple enough to state in a sentence and is all you need to reason
about: **it runs your program's steps in order, inside the surrounding transaction, and anything
that reverts reverts the whole thing.** There is no partial execution, no retry, no rollback of one
step. The bytecode is Sauce's own — not a Solidity contract's deployment code, not a Solana ELF
program — and only a Sauce engine interprets it.

## From a name to a contract call

Inside an EVM route body you write:

```js
USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
```

The destination chain picks which `USDC` and which router that means. Before compiling, the SDK
rewrites those names into ABI-bound contract calls, supplies the matching ABIs and injects the
addresses. The compiler sees the equivalent `IERC20.at(...).approve(...)`.

These names belong to the SDK's route path, not to the compiler. A direct `compile()` call resolves
nothing for you: bind ABIs and supply addresses yourself. See
[protocols and tokens](../guides/protocols-and-tokens.md) and [compiling](../guides/compiling.md).

## Two environments that look alike

A route body is **source text**, not a callback. The SDK reads it, rewrites it and compiles it; it
is never invoked as JavaScript and captures no surrounding variable. A host `const amount = …` does
not exist inside the program — pass it through `defines`.

That is why `Base` and `USDC` behave differently even though both are bare names. `Base` is a named
export you import. `USDC` is program syntax the compiler resolves. The package ships TypeScript
declarations for the program names so a typed body still checks, but a declaration is a type, not a
value.

## From bytecode to execution

### EVM

A program runs through `Pot.cook(engine, program)`. A Pot has an owner; the engine is named on each
cook, so building a call needs **both** addresses — the SDK will not guess either. An engine accepts
only Pots created by its own Kitchen.

Every cook must send the Kitchen's current `executionFee()` as native value, even for a program that
moves only ERC-20s. Native the program itself spends is on top of that. A balance already sitting in
the Pot does not pay the fee.

One route body is one program and one cook, however many statements it contains. For a Portal-driven
intent the Pot's owner must be the destination `Portal.executor()`, and the Pot is shared: put
assets in, use them and take the remainder out within the same fulfillment.
[Intent setup](../guides/intents.md#prepare-the-destination-pot) has the reads and the deployment call.

### Solana

The compiler returns an **account manifest** alongside the bytecode. Each `Account` parameter of
`main` is a slot; its `Writable`/`Signer` modifiers state the role that slot requires. Account
identities travel with the instruction, separately from the encoded argument values.

The SDK resolves those slots into a plan, builds the instructions and transactions, and can stage a
larger program through the Kitchen before executing it. See the [Solana guide](../guides/solana.md).

## Intents connect executions across chains

`Base(body, options).reward(reward)` builds an Eco intent whose route executes on Base. The SDK
compiles the destination program, assembles the route, and hands back hashes and Portal calldata.

Building an intent publishes nothing. Your application submits the source-chain transactions, and a
solver fulfills the destination. Nested intents are separate executions composed with `.nest(...)` —
a cascade, not one call stack spanning chains. See [create an intent](../guides/intents.md).

## Versions travel with artifacts

A compiled program is paired with an engine that understands it. The compiler reports what it
produced; it does not inspect an address to find out what is deployed there. Read the deployment
helpers in `@eco-incorp/sauce/deployments` for released engine and Kitchen addresses, and confirm the
code is live on the chain or cluster you are targeting.

Changing the compiler can change bytecode without changing a line of source. Anything that pins
bytes — a settlement hash, a cached program, a staged code account — has to be re-derived when the
compiler moves. Keep the compiler version, target and argument format with any artifact you store.
[Verification](../guides/verification.md) covers the settlement pins the SDK ships.
