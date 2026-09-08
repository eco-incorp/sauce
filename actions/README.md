# @eco-incorp/sauce-actions

Converts high-level routing actions (swaps, bridges, wraps, staking, lending, transfers) into Sauce bytecode for on-chain execution.

Each action is emitted as **SauceScript source** and compiled by the published Rust/wasm compiler
(`@eco-incorp/sauce-compiler`, depended on under the alias `sauce-compiler`). The output is V12
bytecode: it runs on the V12 engine, and the compiled program IS the calldata you send to it — the
payload is `[program | args]`, with no `cook` selector to prefix.

## Usage

```typescript
import { actionsToSauce } from "@eco-incorp/sauce-actions";
import type { RoutingAction } from "@eco-incorp/sauce-actions";

const actions: RoutingAction[] = [
  {
    type: "uniswapV3ExactInput",
    chainId: 1,
    router: "0x...",
    tokenIn: "0x...",
    tokenOut: "0x...",
    fee: 3000,
    amountIn: "1000000000000000000",
    amountOutMin: "900000000",
    recipient: "0x...",
    deadline: Math.floor(Date.now() / 1000) + 3600,
  },
];

const bytecode = actionsToSauce(actions);
```

## Action chaining

Actions can be chained so that the output of one feeds into the next:

- **Implicit chaining** — the output of the previous action automatically becomes the input of the next (when no explicit `amountIn` is set).
- **Named slots** — use `saveOutputAs` / `amountRef` for explicit cross-referencing.

A slot name becomes a local variable in the emitted SauceScript, so it must be a valid identifier.

## Reading the generated source

Every generator has a `…Source` twin that stops one step short of the compiler, which is what you
want for diffing, review, or debugging a revert:

```typescript
import { actionsToSauceSource, megasSwapToSauceSource } from "@eco-incorp/sauce-actions";

console.log(actionsToSauceSource(actions));
```

Amounts are BAKED into the source as literals rather than passed as runtime arguments. A
parameterized `main` does work on the EVM (the args are appended to the payload), but an action list
already carries its amounts as data, and a program used as a `cook` ingredient has no place to
append them.

## Breaking changes vs the TypeScript-compiler version

- `buildAction(saucer, action, amountIn, outputChained)` is now
  `buildAction(emit, action, amountIn, needsOutput)` — pass an `Emitter` from `newEmitter()` and a
  SauceScript amount expression (a string), and read `{ stmts, output }` source fragments instead of
  builder nodes.
- `QuoteCall.toSauce` / `toSauceDynamic` take an `Emitter` (plus, for the dynamic form, an amount
  expression) and return a `{ stmts, expr }` fragment instead of a `Saucer`.
- `megasSwapToSauce` still returns `Uint8Array[]`, but always with ONE element. The old `N + 3`
  programs existed because the retired compiler had no module linker; `quote_i` / `quote_any` /
  `swap_any` are now declared functions inside one program. `cook(programs)` is unchanged.

## Building

```bash
npm install
npm run build
```

## Testing

Offline — no fork, no network. This is what CI runs:

```bash
npm run test:unit    # tests/to-sauce.unit.test.ts + tests/megas-swap.unit.test.ts
```

Against a Hardhat fork, which needs a `FORK_URL` and the V12 engine artifact
(`pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines`, or point
`SAUCE_V12_RUNTIME_CREATION_HEX` at a file of runtime creation hex):

```bash
FORK_URL=https://... npm test               # + tests/to-sauce.test.ts, tests/to-quote.test.ts
FORK_URL=https://... npm run test:megas-swap
```
