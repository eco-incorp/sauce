---
name: sauce-typescript
description: The TypeScript side of Sauce (@eco-incorp/sauce), for application code that builds the transactions itself. Compiling a .sauce.ts program for a chain exactly as the sauce command does, encoding its main(...) arguments and the Pot.cook transaction, deriving and deploying the owner's Pot, the raw compiler and compact arguments, the protocol registry, JSON action programs, settlement verification, the Solana Kitchen client and token helpers, testing on a forked chain, browser compilation with ready(), which import or subpath to use, and the rule that the library embeds no RPC. Use when writing application or script code that compiles, encodes, verifies, tests or submits Sauce programs, or when the user asks which import or subpath to use.
---

# Sauce from TypeScript

Every `sauce` command is a thin layer over the package's functions; this skill owns calling them
from application code. The program itself is still SauceScript (`sauce-script`); a person at a
terminal uses the command (`sauce-cli`). It is the one skill that points into the package's own
manual, which starts at `node_modules/@eco-incorp/sauce/docs/README.md`, with the subpath list at
`node_modules/@eco-incorp/sauce/docs/api/README.md` and a first walk-through (install, compile, cook,
simulate) at `node_modules/@eco-incorp/sauce/docs/guides/typescript-quick-start.md`.

## When to use

| Task                                                              | Here | Elsewhere      |
| ----------------------------------------------------------------- | ---- | -------------- |
| A service compiles a program and builds its cook                  | yes  |                |
| The raw compiler, compact arguments, a custom resolver, a browser | yes  |                |
| The registry, actions, verification or Solana from code           | yes  |                |
| Tests that run programs on a forked EVM chain or Solana           | yes  |                |
| Writing the program                                               |      | `sauce-script` |
| Running it by hand                                                |      | `sauce-cli`    |

## Core model

- **The library embeds no RPC endpoint and reads no environment variable**: anything an import does
  that touches a chain takes a client or an `rpcUrl` from you (only the `sauce` command falls back
  to public endpoints). Every address comes from the package (`/deployments`, the registries) or
  from the developer; never invent one.
- **A project depends on `@eco-incorp/sauce` and `viem`, both directly**: the API is typed in viem's
  types (`Address`, `Hex`, `PublicClient`), and a package manager that installs a package's own
  dependencies beside it (pnpm) resolves only the project's. Pin viem to the version the package
  resolves; `sauce init` writes both pins. Everything else, the Solana kit included, comes from the
  package's subpaths (`@eco-incorp/sauce/svm` re-exports the kit primitives its functions take).
- **The builders are not gated** by chain, but follow the supported-chains rule (`sauce-overview`):
  build and send a cook or a Pot's deployment only for a supported chain.

| Need                                  | Import                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Compile for a chain, encode arguments | `routes` from `@eco-incorp/sauce`                                                           |
| The Pot and its cook                  | `v12PredictPot`, `DEFAULT_POT_SALT`, `kitchenExecutionFee` (root); `v12Pot` (`/evm/engine`) |
| Release addresses                     | `@eco-incorp/sauce/deployments`                                                             |
| The raw compiler                      | `@eco-incorp/sauce/compiler`                                                                |
| The protocol registry                 | root (`getProtocol`, `contracts`), `@eco-incorp/sauce/protocols/<slug>`                     |
| Action programs                       | `@eco-incorp/sauce/actions`                                                                 |
| Verification                          | `@eco-incorp/sauce/verify`, `/svm/verify`                                                   |
| Solana                                | `@eco-incorp/sauce/svm`; `/svm/engine-artifacts` (Node only)                                |
| Testing                               | `@eco-incorp/sauce/testing` (Node only)                                                     |

## Compile a program for a chain, and cook it

`routes.compileSauceProgram(chain, source, options)` is what `sauce compile` runs: the chain's names
and `@sauce/token`, with `options.args` to fix `main`'s arguments into the program. Without `args`,
the result carries `main`'s declared parameters (`entryParams`); `routes.encodeEntryArguments`
encodes values for them as `--args` does, and program plus arguments is the `program` of the
owner's `Pot.cook(engine, program)`. `DEFAULT_POT_SALT` is every owner's default Pot salt, the zero
bytes32.

```ts
import { readFileSync } from "node:fs";
import { DEFAULT_POT_SALT, kitchenExecutionFee, routes, v12PredictPot } from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, getAddress, type PublicClient } from "viem";

type Address = `0x${string}`;

export async function cookTransactions(
  client: PublicClient, // the chain's: the program is compiled for it and the fee read from it
  file: string,
  chain: string,
  owner: Address,
  args: readonly (bigint | string | boolean)[],
) {
  const salt = DEFAULT_POT_SALT; // every owner's default Pot salt: zero
  const pot = v12PredictPot(owner, salt); // the owner's Pot, derived through the released Kitchen
  const deploy = routes.sauceEvmDeployPotCall({ owner, salt }); // once, through the Kitchen
  const program = routes.compileSauceProgram(chain, readFileSync(file, "utf8"));
  const encoded = routes.encodeEntryArguments(program, args); // checked against main's types
  const engine = getAddress(v12EngineAddress());
  const payload = concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)]);
  // The cook's value is the Kitchen's executionFee(), read just before sending: a cook paying
  // less reverts.
  const fee = kitchenExecutionFee();
  const { data: answer } = await client.call({ to: fee.to, data: fee.data });
  if (answer === undefined) throw new Error("the Kitchen did not answer executionFee()");
  const cook = {
    chainId: await client.getChainId(),
    to: pot,
    data: v12Pot.encodeCook(engine, payload),
    value: fee.decode(answer),
  };

  return { deploy, cook }; // cook is what `sauce tx` prints: { chainId, to, data, value }
}
```

- `kitchenExecutionFee()` builds the fee read (`{ to, data, decode }`) for the chain's Kitchen;
  send it as an `eth_call` just before the cook.
- `routes.sauceEvmDeployPotCall` and `routes.buildSauceEvmCall` return `{ to, data, value }` to send
  as a transaction (and `target`, the same contract as `to`).
- `v12EngineAddress()` and `v12KitchenAddress()` are recorded release addresses, and the deploy call
  goes to the Kitchen unless you pass `kitchen`: check the chain has code at them, and deploy the Pot
  only where it has no code yet.
- A Pot swaps through the Router its Kitchen handed it when it was minted. `potRouterUpdate(client,
pot)` from `/evm/engine` reads both, and returns the `setRouter` call for the Pot's owner to send
  when the Kitchen has a newer one.

## The raw compiler

`compile({ target, entry, resolve, ... })` from `/compiler` compiles a program and resolves nothing
for you: no registry names, no chain defines, no token syntax. Reach for it for full control of the
source and resolver, closure entries, and compile-time scalar arguments.

- ABI-v1 is the only entry encoding. The raw compiler returns `entryParams`, the ABI signature,
  and `entrySignature`, the declared SauceScript types. A top-level fixed-size tuple parameter has
  `indirect: true` and belongs behind an offset; plain `encodeAbiParameters` inlines it instead.
  `routes.encodeEntryArguments` writes the SDK program's required layout.
- `entryKind: "closure"` parses one function-expression string verbatim; raw `args` binds scalar
  parameters at compilation. Runtime ABI inputs disappear from `entryParams` when bound.
- `Int256` entry values are signed and range-checked. Encode negative values as signed ABI words;
  use the typed SDK encoder rather than converting them to unsigned maxima.
- `resolveSdkModule` and `resolveSdkPackage` serve `@sauce/token`, `@sauce/router`, the package's
  artifact ABIs (`./artifacts/IERC20.json`, `./artifacts/ISauceRouter.json`) and every
  `./protocols/<slug>/<Export>.json` to your resolver.
- In a browser, `await ready()` once before the first compile. Every subpath runs in a browser but
  two, which are Node-only: `/svm/engine-artifacts` and `/testing`. Reference:
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
// Whether a namespace contract is deployed on a chain, and where.
export const aave = contracts.on("base").AaveV3.Pool; // { available, address, abi, methods, … }
export const pancake = contracts.on("optimism").PancakeswapV3.Factory.available; // false
```

Each protocol module exports `protocolInfo`, `deployments`, its ABIs (`…ABI`), and its SauceScript
templates by name (`supply`, `swap`, `getPool`, …). `getProtocolSkill(slug)`, `getProtocolIndex()`
and `listSkillSlugs()` from `@eco-incorp/sauce/skills` return the `sauce-protocols` documents. An
address in `deployments` is recorded, not proof of live code.

## Actions, verification, Solana, testing

- **JSON action programs** (`/actions`): `compileProgram(program, { chain })` compiles a document for
  any chain that has its names; a name the chain lacks throws `ProgramError`, whose `issues` and
  `chain` say which. `argument` actions become runtime amounts; `quoteAction(...)` and
  `compileSplitSwap(...)` resolve names on `chain` the same way. Writing the documents is
  `sauce-actions`'s. Reference: `node_modules/@eco-incorp/sauce/docs/guides/actions.md`.
- **Settlement verification** (`/verify`, `/svm/verify`): `validateSettleProgram`,
  `decodeSettleCall` (a cook's calldata), historical pins. It identifies the program and its
  parameters; the Pot, engine and every other call stay yours to check (`sauce verify` runs it).
- **Solana** (`/svm`):
  - the Kitchen client, `createSauceSvmClient({ rpcUrl, payer, programId, kitchen, maxExecutionFee })`,
    with no default endpoint (`via: "engine"` for a direct cook; `executionFee()` quotes the fee to
    set `maxExecutionFee` from). The SVM route helpers (`buildSauceSvmCall`, `buildSauceSvmCalls`)
    do not produce an instruction the engine accepts: build execution with the Kitchen client.
    A cook too wide for one transaction needs no code of your own: `execute` and `executeStaged`
    create a lookup table over exactly the accounts a table may hold and send through it (the
    result's `lookupTableAddress`; `lookupTable: <address>` reuses one, `false` opts out), and
    `cookLookupTable`/`stagedCookLookupTable` make it ready for `simulate` or `cookTransaction`,
    which take its `lookupTables`.
  - `resolveSvmToken(load, mint)` reads a mint through an owned-account loader: its token program
    (by the mint's owner), decimals, extensions, and why a checked transfer of it would be refused;
    `svmTokenAccount(token, owner)` derives a holder's account under that program;
    `svmTokenReceived`/`svmTokenToSend` net a Token-2022 transfer fee exactly. `USDC_MINT` is
    mainnet's USDC mint. The token builder generates Token-2022 and `TransferChecked` programs:
    `token.Token.transfer({ amount, svm: { ... } }).source("svm")`, with top-level
    `tokenProgram: "token-2022"`.
  - A program compiled with the token methods, or writing an account where it uses it, carries
    `derivedAccounts`: each slot the SDK added to `main`, by name, with its derivation as an
    `--account` value (`self:USDC`, `@to:USDC`, `pda:@program:"state",@owner`);
    `routes.sourceGlobals("solana").accounts` lists the expressions.
    `resolveSvmAccountName(derivation, { chain, owner, pot, via, args, programOf })` resolves one to
    the address the cook's `AccountResolution` takes, as `sauce run` does; a venue namespace's
    `slot:@pool:USDC.<part>` also needs `load`, an owned-account loader, through which it reads the
    pool's nine accounts (give `slots`, one map per cook, to read each pool once).
  - A venue namespace's swap at a price is listed in `stoppable`, by its stop's derivation
    (`stop:<pool>:<token>:<limit>`). `svmProgramStops(program, chain, accounts, integers, load)`
    from `@eco-incorp/sauce/svm` works each stop out as `sauce` does (`accounts`: each derived name
    resolved; `integers`: main's `Uint256` arguments by name), the pool buying the most per unit first within one
    cook's compute units, and names in `binding` the swaps to hold. Compile again with
    `{ stops: binding }`: those swaps call the Stopped form, each stop a `Uint256` added to `main`
    after the accounts (`derivedValues`, never one of `entryParams`), encoded after main's own
    arguments as `svmStopValues(stops, program)` gives them. With nothing binding, the plain
    program is the one to cook. `SVM_SWAP_COSTS` is the cost table.
  - Venue adapters (`venue("raydium-cp-swap")`, also `Solana.RaydiumCpSwap`) build pool configs,
    quote source and swap CPIs over an account loader you supply; a venue swap they build uses a
    minimum output of one, so enforce the real minimum with a balance delta in the program.
  - For a local validator or LiteSVM, `svmEnginePath()`, `svmKitchenPath()` and
    `svmKitchenIdlPath()` from `@eco-incorp/sauce/svm/engine-artifacts` (Node only) locate the
    packaged programs; their ids are `v12SvmEngineProgramId()` and `v12SvmKitchenProgramId()` from
    `/deployments`. Writing the programs is `sauce-solana`'s.
  - Reference: `node_modules/@eco-incorp/sauce/docs/guides/solana-from-typescript.md` (compile and
    keep the account list, create the client, simulate, send, build the pieces yourself) and, for
    the swap functions a program calls on Solana,
    `node_modules/@eco-incorp/sauce/docs/api/router-solana.md`.
- **Testing** (`/testing`, Node only, Foundry's `anvil` on `PATH`): `fork(chain, { block, state,
rpcUrl })` forks a chain at a pinned block on a local anvil (replaying `state`, a recorded file
  committed beside the tests, with no endpoint; recording it through `rpcUrl` when it is missing),
  and `local()` starts an empty chain. Either has the released Kitchen and engine, and test accounts
  each with a Pot (`account(i).pot`). `fund(holder, { USDC: "100" })` writes a balance,
  `run(file, { args })` sends a cook and `simulate` runs one without sending it: what `main`
  returned (`returned`), each token's movement (`delta(holder, "WETH")`), or `CookReverted` with the
  program's `require` message. `snapshot()`/`revert()` isolate tests; write them with `node:test`.
  It runs Solana too, in LiteSVM, which the project installs at the version the package pins (no
  anvil): `fork("solana", { state, rpcUrl, mode })` records the accounts the test's transactions
  name and replays them with no RPC, and `local({ chain: "solana" })` is an empty chain. There,
  `run` and `simulate` take `accounts` in `--account`'s names (`pot:USDC`, `@to:USDC`,
  `mint:PYUSD`), derive the rest, create the token accounts the cook names that are missing, and
  stage a program too large for one transaction; `fund(holder, { USDC: "1", SOL: "1" })` writes
  balances, and `CookReverted`'s `reason` is the program's `require` message.
  Reference: `node_modules/@eco-incorp/sauce/docs/guides/testing.md` (one task at a time) and
  `node_modules/@eco-incorp/sauce/docs/api/testing-kit.md` (every export of `/testing`).

## Pitfalls

- **An endpoint expected from the package.** Pass a client or an `rpcUrl`.
- **viem resolved twice.** Depend on it directly, pinned to the package's version.
- **A tuple argument encoded with `encodeAbiParameters`.** `main` reads it behind an offset word: use
  `routes.encodeEntryArguments`.
- **A stale fee.** Read the Kitchen's `executionFee()` just before sending; less reverts.
- **The SVM route helpers used for execution.** Build cooks with the Kitchen client.
- **A recorded address trusted as live.** Check the chain has code at it.
- **Compiling in a browser before `ready()`.** Await it once first.

## Files

- [examples/cook.mts](examples/cook.mts): the Pot, its deploy call and a cook with arguments, offline,
  and the packaged Solana binaries.
- [examples/compiler.mts](examples/compiler.mts): the raw compiler, ABI-v1 arguments,
  `@sauce/token` through the package's resolvers.
- [examples/actions.mts](examples/actions.mts): the action-program pipeline: validation, runtime
  amounts, a quote.
- [examples/verify.mts](examples/verify.mts): settlement verification: a payload, a cook, a tampered
  program, pins, reproduction.
