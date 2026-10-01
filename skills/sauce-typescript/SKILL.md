---
name: sauce-typescript
description: The TypeScript side of Sauce (@eco-incorp/sauce) — compiling a .sauce.ts program for a chain from application code exactly as the sauce command does, encoding its main(...) arguments and the Pot.cook transaction, deriving and deploying the owner's Pot, the raw compiler with typed programs and compact arguments, JSON action programs, settlement verification, browser compilation with ready(), and the rule that the package embeds no RPC. Use when writing application or script code that compiles, encodes, verifies or submits Sauce programs, or when the user asks which import or subpath to use.
---

# Sauce from TypeScript

Write the program in SauceScript first (`sauce-script`, `sauce-globals`), and run it with the
`sauce` command (`sauce-run`). Reach for TypeScript when an application builds the transactions
itself: every command is a thin layer over the functions below. The package embeds no RPC endpoint
and reads no environment variable: anything that touches a chain takes a client or an `rpcUrl` from
you. Every address comes from the package (`/deployments`, the registries) or from the developer;
never invent one. The shipped manual starts at `node_modules/@eco-incorp/sauce/docs/README.md`; the
subpath list is `node_modules/@eco-incorp/sauce/docs/api/README.md`.

## Compile a program for a chain, and cook it

`routes.compileSauceProgram(chain, source, options)` is what `sauce compile` runs: the chain's
names, its defines and `@sauce/token`, with `options.defines` for the program's own compile-time
values and `options.intents` for the intents it opens. The result carries `main`'s declared
parameters (`entryParams`); `routes.encodeEntryArguments` encodes values for them as `--args` does,
and program plus arguments is the `program` of the owner's `Pot.cook(engine, program)`.

```ts
import { readFileSync } from "node:fs";
import { routes, v12GateKitchen, v12PredictPot } from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, getAddress } from "viem";

type Address = `0x${string}`;

export function cookTransactions(
  file: string,
  chain: string,
  owner: Address,
  args: readonly (bigint | string | boolean)[],
) {
  const salt = `0x${"00".repeat(32)}` as const;
  const pot = v12PredictPot(owner, salt); // the owner's Pot, derived through the released Kitchen
  const deploy = routes.sauceEvmDeployPotCall({ kitchen: v12GateKitchen(), owner, salt }); // once
  const program = routes.compileSauceProgram(chain, readFileSync(file, "utf8"));
  const encoded = routes.encodeEntryArguments(program, args); // checked against main's types
  const engine = getAddress(v12EngineAddress());
  const payload = concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)]);
  // The owner sends the cook with value = the Kitchen's executionFee(), read at run time.
  return { deploy, cook: { to: pot, data: v12Pot.encodeCook(engine, payload) } };
}
```

- `destinationExecutionFee()` builds the fee read (`{ to, data, decode }`); send it as an `eth_call`
  on the chain with your client, just before sending the cook.
- `v12EngineAddress()`, `v12KitchenAddress()` and `v12GateKitchen()` are recorded release
  addresses: check the chain has code at them. Deploy the Pot only where it has no code yet.
- A program that opens an intent also needs `options.intents`, `{ deadline, creator,
executionFee }` (`sauce-intents`).

## The raw compiler

`compile({ target, entry, resolve, ... })` from `/compiler` compiles a **typed** program and resolves
nothing for you: no registry names, no chain defines. Reach for it for full control of the source
and resolver, typed programs the way the reference writes them, and compact arguments.

- ABI-v1 arguments by default; `compactArgs: true` returns an `entrySchema` for
  `encodeCompactArguments`/`decodeCompactArguments` (`scalarWidth` keeps offsets fixed).
- `resolveSdkModule` and `resolveSdkPackage` serve `@sauce/token`, the package's artifact ABIs and
  every `./protocols/<slug>/<Export>.json` to your resolver.
- In a browser, `await ready()` once before the first compile; `/svm/engine-artifacts` is the one
  Node-only subpath. See [examples/compiler.mts](examples/compiler.mts) and
  `node_modules/@eco-incorp/sauce/docs/api/compiler.md`.

## The protocol registry

```ts
import { contracts, getProtocol, getProtocolsByChain, listProtocolSlugs } from "@eco-incorp/sauce";
import * as pancakeV3 from "@eco-incorp/sauce/protocols/pancakeswap-v3";

export const onBase = getProtocolsByChain(8453).map((p) => p.slug); // catalogued on Base
export const info = getProtocol("pancakeswap-v3"); // name, category, chains, website
export const slugs = listProtocolSlugs();
// Per-chain addresses by role, e.g. { factory, smartRouter, nonfungiblePositionManager }.
export const pancakeOnBase = pancakeV3.deployments.find((d) => d.chainId === 8453)?.addresses;
// Whether a namespace contract is callable by name on a chain, and where.
export const aave = contracts.on("base").AaveV3.Pool; // { available, address, abi, methods, … }
```

Each protocol module (`@eco-incorp/sauce/protocols/<slug>`) exports `protocolInfo`, `deployments`,
its ABIs (`…ABI`), and its SauceScript templates by name (`supply`, `swap`, `getPool`, …).
`getProtocolSkill(slug)`, `getProtocolIndex()` and `listSkillSlugs()` from
`@eco-incorp/sauce/skills` return the `sauce-protocols` documents. A catalogued protocol is not
necessarily callable by name, and an address in `deployments` is a recorded address, not proof of
live code on the chain.

## Other host tools

- **JSON action programs** (`/actions`): `parseProgram`, `compileProgram` (with `argument` actions
  as runtime amounts), `quoteAction`, `compileSplitSwap`. Reference:
  `node_modules/@eco-incorp/sauce/docs/guides/actions.md`; see
  [examples/actions.mts](examples/actions.mts).
- **Settlement verification** (`/verify`, `/svm/verify`): `validateSettleProgram`,
  `decodeSettleCall`, `extractEvmSettleFromIntent`, historical pins. It identifies the program and
  its parameters; the Pot, engine and every other call stay yours to check (`sauce verify` runs
  it). See [examples/verify.mts](examples/verify.mts).
- **Solana execution**: the Kitchen client, `sauce-solana`.

## Example

[examples/cook.mts](examples/cook.mts) builds the Pot, its deploy call and a cook with arguments
offline; [examples/compiler.mts](examples/compiler.mts),
[examples/actions.mts](examples/actions.mts) and [examples/verify.mts](examples/verify.mts) run the
raw compiler and argument codecs, the action-program pipeline, and settlement verification.
