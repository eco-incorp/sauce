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

This is a complete program. It builds an Eco intent offline: the creator and the fee are fixtures
and nothing is sent to a chain.

```ts
import { Base } from "@eco-incorp/sauce";

const executionFee = 1_000n; // Fixture: read Base's Kitchen fee with destinationExecutionFee().

const built = Base(
  () => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  },
  { execution: { value: executionFee }, deadline: 2_000_000_000n },
).reward({
  source: "ethereum",
  creator: "0x4444444444444444444444444444444444444444",
  deadline: 2_000_003_600n,
});

console.log(built.hash().intentHash);
```

`Base` names the **destination**, the chain the program runs on; `.reward(...)` names the
**source**, where the reward is escrowed. That one expression does what an intent otherwise takes
by hand:

- looks up USDC and the Universal Router on Base, and binds the ERC-20 ABI;
- compiles the body, so there is no contract to write or deploy;
- derives the Pot and engine, and encodes the `cook(engine, program)` call on that Pot — the shared
  one the solver deploys for that Portal;
- looks up the eco-routes Portal on both chains, and the prover for the pair;
- sets the route's native amount, what the solver sends with the fill, to what its calls spend: here
  the cook's fee;
- assembles the route and reward, which is all `built.hash()` and the source Portal requests need.

Each of those is an option you can override, for a deployment the registry does not carry. What
stays yours: the deadlines, the creator, the Kitchen fee, and a reward that pays a solver to fill
the intent. The fee is on-chain state, so the SDK builds its read, `destinationExecutionFee()`, and
does not guess it. The SDK sends nothing, and it does not price the reward.

Ethereum and Base are two of the three chains the initial release supports, with Solana. Every
other chain in the registry is a preview chain: the SDK builds for it at your own risk, and the
`sauce` command and MCP server compile and simulate there but build no transaction
([Chains](../reference/chains.md)).

## The three things that trip people up

**The callback is source, not a function.** It is read with `Function.prototype.toString()`, parsed
and compiled. It never runs as JavaScript, so it captures nothing: a surrounding `const amount` is
invisible inside it. Pass application values through `defines`, or write the body as a string. If
your bundler rewrites function bodies, use a string or a source file.

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

The destination assets and the source reward are separate things. Destination `tokens` arrive at the
Portal's Executor, so a program that spends them needs a transfer precall moving them into the Pot
first. Source reward tokens are approved to the source Portal, which escrows them in the intent vault.

[first-intent.ts](../examples/first-intent.ts) builds both sides and returns the source transaction
requests. Read [create an intent](intents.md) before submitting them, and
[nested intents](nested-intents.md) to chain a second execution onto the first.

## Compile without an intent

Reach for `@eco-incorp/sauce/compiler` when you want raw bytecode, runtime entry arguments or a
Solana account manifest — a reusable program you supply values to at execution time rather than one
specialised at compile time.

[compile-program.ts](../examples/compile-program.ts) compiles a typed entry point and appends compact
arguments. [Compiling programs](compiling.md) explains module resolution and how the raw compiler
differs from the route wrapper.
