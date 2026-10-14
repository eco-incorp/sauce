# Quick start

[Documentation](../README.md) · [Protocols and tokens](protocols-and-tokens.md) · [Compiling](compiling.md)

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
creates Pots. Your own programs run on your Pot, which only you can cook on.
[Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md) explains the three.

## Compile your first program

This is a complete program. It compiles a Sauce program for Base offline: nothing is sent to a
chain.

```ts
import { routes } from "@eco-incorp/sauce";

const program = routes.compileSauceProgram(
  "base",
  `function main(amount: Uint256) {
    USDC.approve(Uniswap.UniversalRouter, amount);
  }`,
);

// What a Pot cooks: the bytecode, with main's argument appended.
const args = routes.encodeEntryArguments(program, [1_000_000n]);
console.log(`${program.bytecode.length} bytes, plus ${args.length} of arguments`);
```

`"base"` names the chain the program runs on. That one call does what a transaction otherwise takes
by hand:

- looks up USDC and the Universal Router on Base, and binds the ERC-20 ABI;
- compiles the program, so there is no contract to write or deploy;
- reports `main`'s parameters in `program.entryParams`, whose values arrive with each cook:
  `routes.encodeEntryArguments` encodes them, and the cook appends them to the bytecode.

The cook is `cook(engine, program)` sent to your Pot from its owner, with the Kitchen's fee as its
value: `v12Pot.encodeCook(engine, program)` from `@eco-incorp/sauce/evm/engine` encodes it, and
`sauce run` builds and sends it from a terminal. The fee is on-chain state, so the SDK builds its
read, `destinationExecutionFee()`, and does not guess it.

Ethereum and Base are two of the three chains the initial release supports, with Solana. Every
other chain in the registry is a preview chain: the SDK builds for it at your own risk, and the
`sauce` command and MCP server compile and simulate there but build no transaction
([Chains](../reference/chains.md)).

## The two things that trip people up

**`USDC` and `Uniswap` are not imports.** They are program syntax the compiler resolves against the
chain it compiles for. The package ships TypeScript declarations so a typed program checks, but
there is no JavaScript object to import. The registered spelling of the router is
`UniswapV4.UniversalRouter`, with `Uniswap.UniversalRouter` as an unambiguous family alias;
`UniswapV3.UniversalRouter` does not exist. [Protocols](../reference/protocols.md) lists what is
registered.

**An amount is an argument or a reading, not a capture.** The program is source text: it reads no
value of the TypeScript around it. A value the caller knows is one of `main`'s parameters, and a
value only the chain knows is read where the program runs (`USDC.balanceOf(ctx.self())`).

## Compile without the registry

Reach for `@eco-incorp/sauce/compiler` when you want raw bytecode, a compact entry schema or a
Solana account manifest, with no chain's names resolved for you.

[compile-program.ts](../examples/compile-program.ts) compiles a typed entry point and appends compact
arguments. [Compiling programs](compiling.md) explains module resolution and how the raw compiler
differs from `compileSauceProgram`.

## Next: another chain

A program that continues on another chain, by opening an Eco intent there, is
[coming soon](intents.md), written `<Chain>.hop({ send, receive, refundee }).then(() => { … })`.
That page also covers acting on an intent that already exists.
