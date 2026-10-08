# Quick start

[Documentation](../README.md) · [Protocols and tokens](protocols-and-tokens.md) · [Create an intent](intents.md)

```sh
pnpm add @eco-incorp/sauce
```

Node.js **24 or newer**. The SauceScript compiler is a dependency of this package — there is nothing
else to install and no compiler checkout to keep in sync. For [the `sauce` command](cli.md), install
the package once globally: `npm i -g @eco-incorp/sauce`, then `sauce --version`
(`npm i -g @eco-incorp/sauce@latest` upgrades it).

## Where a program runs

A compiled program runs in a **cook**: one transaction to a **Pot**, the contract that holds what the
program spends and makes its calls. Every cook pays a flat fee to the **Kitchen**, the contract that
creates Pots. Your own programs run on your Pot, which only you can cook on. The intent below runs
its body on another Pot, the one the destination chain's intent contracts own and every solver's
fulfillment cooks on. [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md) explains the three.

## Build your first intent

This is a complete program. It builds an Eco intent offline: the owner, the reward and the fees are
fixtures and nothing is sent to a chain.

```ts
import { Base, Ethereum } from "@eco-incorp/sauce";

const owner = "0x4444444444444444444444444444444444444444";
const kitchenFee = 1_000n; // Fixture: read each Kitchen's fee with destinationExecutionFee().

const built = Base.hop({
  source: Ethereum,
  send: { token: Ethereum.USDC.address, amount: 10_000n },
  refundee: owner,
  fee: kitchenFee,
}).then(() => {
  USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
});

const cook = built.cook({ owner }, kitchenFee); // { to, data, value }, from your Pot on Ethereum
console.log(`${built.program.bytecode.length} bytes, cooked on ${cook.to}`);
```

`Base.hop` names the **destination**, the chain the body runs on; `send` is what leaves the
**source**, `source`, where it is escrowed for the solver and the intent is published. `receive`
would name what a solver delivers on Base for the body to use: nothing, here. `.then(...)` writes the statement
a Sauce program opens that intent with, `Base.hop({ … }).then(() => { … })`, and compiles it for
Ethereum: the intent is the same one a program in a file opens. That one expression does what an intent otherwise takes by
hand:

- looks up USDC and the Universal Router on Base, and binds the ERC-20 ABI;
- compiles the body for Base, so there is no contract to write or deploy;
- derives the destination's Pot and engine, and encodes the `cook(engine, program)` call on that
  Pot — the shared one the solver deploys for that Portal;
- looks up the eco-routes Portal on both chains, and the prover for the pair;
- sets the route's native amount, what the solver sends with the fill, to what its calls spend: here
  the cook's fee;
- defaults the deadlines, the fill five minutes from when the cook runs and the reward's seven days
  after it, and a random salt;
- compiles the program that opens it, and its cook: the Pot pays the reward into the intent's vault
  and publishes it.

What stays yours: the refundee, the Kitchen fees, and a reward that pays a solver to fill the
intent, which your Pot must hold when the cook runs. The fees are on-chain state, so the SDK builds
their read, `destinationExecutionFee()`, and does not guess them. A field of the hop sets anything else
([Intent defaults](../reference/intent-defaults.md)). The SDK sends nothing, and it does not price
the reward. The intent's hash is the Portal's: send the cook, or rehearse it with
`eth_simulateV1`, and `built.intents(logs)` reads each intent it published, with its hash, from the
`IntentPublished` in its logs.

Ethereum and Base are two of the three chains the initial release supports, with Solana. Every
other chain in the registry is a preview chain: the SDK builds for it at your own risk, and the
`sauce` command and MCP server compile and simulate there but build no transaction
([Chains](../reference/chains.md)).

## The three things that trip people up

**The callback is source, not a function.** It is read with `Function.prototype.toString()`, parsed
and compiled. It never runs as JavaScript, so it captures nothing: a surrounding `const amount` is
invisible inside it. Write application values into the body as literals, pass them as defines
(`compile: { defines: { AMOUNT: amount } }`), or write the body as a string with them in
it. If your bundler rewrites function bodies, use a string or a source file.

**`USDC` and `Uniswap` are not imports.** They are program syntax the compiler resolves against the
destination chain. The package ships TypeScript declarations so a typed body checks, but there is no
JavaScript object to import. `Base`, by contrast, _is_ a named export. The registered spelling of the
router is `UniswapV4.UniversalRouter`, with `Uniswap.UniversalRouter` as an unambiguous family alias;
`UniswapV3.UniversalRouter` does not exist. [Protocols](../reference/protocols.md) lists what is registered.

**The Pot is not yours alone.** For a Portal-driven intent the Pot's owner is the destination
`Portal.executor()`, which every solver can drive. The SDK derives that Pot, so the example names
none; the solver deploys it before the intent is fulfilled. Deliver assets into it, use them, and
take the remainder out inside the same fulfillment. Every cook also pays the Kitchen's current fee in native value.
[The destination Pot](intents.md#the-destination-pot) covers deployment and overrides.

## Deliver assets and fund the reward

The destination assets and the source reward are separate things. What `receive` names arrives at
the Portal's Executor, and the intent moves it into the Pot before the body runs. What `send`
names is paid into the intent's vault on the source chain, which escrows it.

[first-intent.ts](../examples/first-intent.ts) builds both sides and the cook that publishes them.
Read [create an intent](intents.md) before sending it, and
[nested intents](nested-intents.md) to chain a second execution onto the first.

## Compile without an intent

Reach for `@eco-incorp/sauce/compiler` when you want raw bytecode, runtime entry arguments or a
Solana account manifest — a reusable program you supply values to at execution time rather than one
specialised at compile time.

[compile-program.ts](../examples/compile-program.ts) compiles a typed entry point and appends compact
arguments. [Compiling programs](compiling.md) explains module resolution and how the raw compiler
differs from the SDK's program compile.
