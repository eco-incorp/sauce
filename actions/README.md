# Actions

[SDK documentation](../docs/README.md) · [Actions guide](../docs/guides/actions.md)

`@eco-incorp/sauce/actions` compiles **action programs** — ordered lists of protocol operations
(swaps, bridges, wrapping, staking, lending, transfers, approvals) written as plain JSON — into one
Sauce program that executes atomically in a Pot, directly or as the destination route of an Eco
intent. Install `@eco-incorp/sauce` to use it.

```ts
import { actionsIntent, compileActions, parseActionProgram } from "@eco-incorp/sauce/actions";

const program = parseActionProgram({
  version: 1,
  chainId: 8453,
  actions: [
    {
      type: "approve",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
      spender: "0x1111111111111111111111111111111111111111", // example spender
      amount: "1000000",
    },
  ],
});

const { bytecode, source } = compileActions(program); // Pot.cook(engine, bytecode)
// or, as an intent: actionsIntent("base", program, intentOptions).reward(reward)
```

- **JSON in, JSON out.** Amounts are base-10 strings. `parseActionProgram` validates strictly and
  reports every problem with its path; `serializeActionProgram` writes canonical JSON; the
  [JSON Schema](action-program.schema.json) ships in the package for clients in other languages.
- **Composition is part of the document.** An action spends its own amount, an earlier output
  named with `saveOutputAs`/`amountRef`, or the previous action's output. `balanceOf` spends what
  the Pot actually holds; `"recipient": "self"` keeps an output in the Pot.
- **Intents and nesting.** `actionsIntent` makes a program a route body. A child of a dynamic
  `.nest()` can start with `balanceOf` to spend exactly what its parent delivered.
- **Runtime amounts.** An `argument` action makes an amount a parameter of one reusable compiled
  program; `compileActions(...).payload(values)` appends the arguments, ABI-v1 or compact-v1.
- **SDK surfaces.** Each call is an ABI binding, with ABIs from the SDK protocol registry where it
  has the exact function. ERC-20 `transfer`/`approve` decode no output, so tokens that return
  nothing (USDT) work.

The [actions guide](../docs/guides/actions.md) covers the format, chaining, intents, runtime
amounts, and the list of supported actions with how each was verified.
[AMM_SWAP_INTERFACES.md](AMM_SWAP_INTERFACES.md) is a contributor's reference to the protocols'
Solidity interfaces.

## Changes from the previous release

The typed API still works: `actionsToSauce`, `actionsToSauceSource`, `actionToSauce`,
`buildAction`, `actionToQuote` and the `megasSwap*` functions keep their names and signatures. What
changed underneath:

- **Emitted source uses ABI bindings.** `actionsToSauceSource` names bindings such as
  `IErc20.at(token).approve(...)`, so compiling it yourself needs their ABIs: use
  `actionsToProgramSource(actions)` (source plus `contracts`) or `compileActions`.
  `buildAction` results carry the `bindings` they name; pass them to `contractsFor`.
- **Stricter chaining.** Setting both an amount and `amountRef`, or giving actions of one list
  different execution chains, now throws an `ActionProgramError` instead of being ignored.
- **Fixed encodings.** Uniswap V4 actions encode their swap parameters as the router decodes them
  and take everything owed (they reverted before); `stargateBridge` calls the Stargate V1 router's
  real `swap`. A chained V4 output is taken to the Pot like every other swap.
- **Types.** `recipient`, `to` and `onBehalfOf` accept `"self"`, and `RoutingAction` gains the
  `balanceOf`, `nativeBalance` and `argument` source actions — an exhaustive `switch` over
  `RoutingAction["type"]` needs cases for them.
