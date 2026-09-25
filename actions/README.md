# Routing actions

[SDK documentation](../docs/README.md) · [Builders and actions](../docs/guides/builders-and-actions.md)

`@eco-incorp/sauce/actions` converts action sequences—swaps, bridges, wraps,
staking, lending, approvals, and transfers—into SauceScript and EVM Sauce
bytecode. Install `@eco-incorp/sauce` to use these helpers.

Each action is emitted as source and compiled by the published Rust/WASM compiler
`@eco-incorp/sauce-compiler`, included with the SDK.

## Usage

```ts
import {
  actionsToSauce,
  actionsToSauceSource,
  type RoutingAction,
} from "@eco-incorp/sauce/actions";

const actions: RoutingAction[] = [
  {
    type: "approve",
    chainId: 8453,
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
    spender: "0x1111111111111111111111111111111111111111", // Example spender
    amount: "1000000",
  },
];

const source = actionsToSauceSource(actions);
const bytecode = actionsToSauce(actions); // Uint8Array: one compiled program
console.log(source);
```

The generated program contains the sequence's amounts and addresses as literals.
To review what will execute, inspect `actionsToSauceSource` before compilation.
`megasSwapToSauceSource` supplies the same inspection surface for the multi-venue
swap generator.

## Execute through a Pot

The released engine accepts execution through its Kitchen/Pot gate. Create a Pot
through the compatible Kitchen and invoke `Pot.cook(engine, program)` as its
authorized owner. The Pot is the account whose balances the program uses; sending
the program directly to an engine address is not the current execution path.

```ts
import { bytesToHex, type Address } from "viem";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";

export function encodeActionCook(engine: Address, bytecode: Uint8Array) {
  return v12Pot.encodeCook(engine, bytesToHex(bytecode));
}
```

Submit the resulting calldata to the Pot, with the deployment's required value
and execution fee. Encoding does not grant ownership, fund the Pot, or submit a
transaction. See [compiling programs](../docs/guides/compiling.md) and the
[engine API exports](../docs/api/README.md) for the surrounding execution setup.

## Action chaining

An action's output can feed later actions:

- **Implicit input:** omitting an action's explicit input amount lets it consume
  the previous action's output where that action supports chaining.
- **Named output:** `saveOutputAs` gives an output a name; `amountRef` consumes it
  later. Names become SauceScript locals and must be valid identifiers.

See [AMM swap interfaces](AMM_SWAP_INTERFACES.md) for protocol-specific action
shapes. `actionToQuote` builds a protocol quoter call; it does not use the Sauce
Router's revert-based unified `quote` method.

Action generators specialize source to the action list. Raw compiler consumers
can instead use runtime `main` parameters and append arguments to a reusable
program; that is a separate API described in the
[compiler guide](../docs/guides/compiling.md).
