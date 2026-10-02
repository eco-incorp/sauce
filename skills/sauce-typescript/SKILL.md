---
name: sauce-typescript
description: The TypeScript side of Sauce (@eco-incorp/sauce) — compiling a .sauce.ts program for a chain from application code exactly as the sauce command does, encoding its main(...) arguments and the Pot.cook transaction, deriving and deploying the owner's Pot, the raw compiler and compact arguments, JSON action programs, settlement verification, browser compilation with ready(), and the rule that the package embeds no RPC. Use when writing application or script code that compiles, encodes, verifies or submits Sauce programs, or when the user asks which import or subpath to use.
---

# Sauce from TypeScript

Write the program in SauceScript first (`sauce-script`, `sauce-globals`), and run it with the
`sauce` command (`sauce-cli`). Reach for TypeScript when an application builds the transactions
itself: every command is a thin layer over the functions below. The package embeds no RPC endpoint
and reads no environment variable: anything that touches a chain takes a client or an `rpcUrl` from
you. Every address comes from the package (`/deployments`, the registries) or from the developer;
never invent one. The shipped manual starts at `node_modules/@eco-incorp/sauce/docs/README.md`; the
subpath list is `node_modules/@eco-incorp/sauce/docs/api/README.md`.

## Supported chains

For the initial release, Sauce supports transactions on Ethereum, Base and Solana. Every other
chain the registry knows is a preview chain: its programs compile and simulate, and the `sauce`
command and the MCP server build and send no transaction there. Application code follows the same
rule: build and send a cook, a Pot's deployment or an intent's transactions only for a supported
chain, and treat a preview chain as compile and simulate only. To ask for a preview chain, find its
request among the
[existing chain-support requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)
and add the use case, or
[open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml).

## Compile a program for a chain, and cook it

`routes.compileSauceProgram(chain, source, options)` is what `sauce compile` runs: the chain's
names and `@sauce/token`, with `options.intents` for the intents it opens, and `options.args` to fix
`main`'s arguments into the program, as `sauce intent publish --args` does for intents published
from a wallet. Without `args`, the result carries `main`'s declared
parameters (`entryParams`); `routes.encodeEntryArguments` encodes values for them as `--args` does,
and program plus arguments is the `program` of the owner's `Pot.cook(engine, program)`.

```ts
import { readFileSync } from "node:fs";
import { destinationExecutionFee, routes, v12PredictPot } from "@eco-incorp/sauce";
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
  const salt = `0x${"00".repeat(32)}` as const;
  const pot = v12PredictPot(owner, salt); // the owner's Pot, derived through the released Kitchen
  const deploy = routes.sauceEvmDeployPotCall({ owner, salt }); // once, through the Kitchen
  const program = routes.compileSauceProgram(chain, readFileSync(file, "utf8"));
  const encoded = routes.encodeEntryArguments(program, args); // checked against main's types
  const engine = getAddress(v12EngineAddress());
  const payload = concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)]);
  // The cook's value is the Kitchen's executionFee(), read just before sending: a cook paying
  // less reverts.
  const fee = destinationExecutionFee();
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

- `destinationExecutionFee()` builds the fee read (`{ to, data, decode }`) for the chain's
  Kitchen; the example sends it as an `eth_call` with the chain's client just before the cook.
- `routes.sauceEvmDeployPotCall` and `routes.buildSauceEvmCall` return `{ to, data, value }` to send
  as a transaction, plus `target`, the same contract as a route's `calls` entry names it.
- `v12EngineAddress()` and `v12KitchenAddress()` are recorded release addresses, and the deploy
  call goes to the Kitchen unless you pass `kitchen`: check the chain has code at them. Deploy the
  Pot only where it has no code yet.
- A Pot swaps through the Router its Kitchen handed it when it was minted. `potRouterUpdate(client,
pot)` from `/evm/engine` reads both, and returns the `setRouter` call for the Pot's owner to send
  when the Kitchen has a newer one.
- A program that opens an intent also needs `options.intents`, `{ deadline, creator,
executionFee }` (`sauce-intents`).

## The raw compiler

`compile({ target, entry, resolve, ... })` from `/compiler` compiles a program and resolves nothing
for you: no registry names, no chain defines, no token syntax. Reach for it for full control of the
source and resolver, and for compact arguments.

- ABI-v1 arguments by default: `abi.encode` of `main`'s parameters, except that a tuple parameter
  is always behind an offset word, even one whose fields are all fixed-size. `encodeAbiParameters`
  inlines that tuple instead; `routes.encodeEntryArguments` writes the layout `main` reads.
- `compactArgs: true` returns an `entrySchema` for
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
// Whether a namespace contract is deployed on a chain, and where.
export const aave = contracts.on("base").AaveV3.Pool; // { available, address, abi, methods, … }
export const pancake = contracts.on("optimism").PancakeswapV3.Factory.available; // false
```

Each protocol module (`@eco-incorp/sauce/protocols/<slug>`) exports `protocolInfo`, `deployments`,
its ABIs (`…ABI`), and its SauceScript templates by name (`supply`, `swap`, `getPool`, …).
`getProtocolSkill(slug)`, `getProtocolIndex()` and `listSkillSlugs()` from
`@eco-incorp/sauce/skills` return the `sauce-protocols` documents. An address in `deployments` is
a recorded address, not proof of live code on the chain.

## Other host tools

- **JSON action programs** (`/actions`): a document names tokens by registry symbol (`"USDC"`) and
  contracts by namespace (`"UniswapV3.Factory"`), and a swap may give its pool by its factory's
  key (`factory` and `fee`). `compileProgram(program, { chain })` compiles it for any chain that
  has those names; a name the chain lacks throws `ProgramError`, whose `issues` and `chain` say
  which. `argument` actions become runtime amounts. `programIntent(...)`, `quoteAction(...)` and
  `compileSplitSwap(...)` resolve names on `chain` the same way. Reference:
  `node_modules/@eco-incorp/sauce/docs/guides/actions.md`; see
  [examples/actions.mts](examples/actions.mts), and `sauce-actions` for writing the documents.
- **Settlement verification** (`/verify`, `/svm/verify`): `validateSettleProgram`,
  `decodeSettleCall`, `extractEvmSettleFromIntent`, historical pins. It identifies the program and
  its parameters; the Pot, engine and every other call stay yours to check (`sauce verify` runs
  it). See [examples/verify.mts](examples/verify.mts).
- **Solana execution** (`/svm`): the Kitchen client,
  `createSauceSvmClient({ rpcUrl, payer, programId, kitchen, maxExecutionFee })`, with no default
  endpoint; the SVM route helpers (`Solana(...)` routes, `buildSauceSvmCall`) do not produce an
  instruction the engine accepts, so build execution with the Kitchen client. `USDC_MINT` is the
  mainnet USDC mint. The token builder generates Token-2022 and `TransferChecked` programs:
  `token.Token.transfer({ amount, svm: { ... } }).source("svm")`, with top-level
  `tokenProgram: "token-2022"`. For a `@sauce/token` program's accounts,
  `resolveSvmToken(load, mint)` reads a mint through an owned-account loader and returns its token
  program (by the mint's owner), decimals and extensions, and why a checked transfer of it would be
  refused; `svmTokenAccount(token, owner)` derives a holder's account under that program, and
  `svmTokenReceived`/`svmTokenToSend` net a Token-2022 transfer fee exactly, either way. Venue adapters (`venue("raydium-cp-swap")`, also `Solana.RaydiumCpSwap`) build
  pool configs, quote source and swap CPIs over an account loader you supply. For a local validator
  or LiteSVM, `svmEnginePath()`, `svmKitchenPath()` and `svmKitchenIdlPath()` from
  `@eco-incorp/sauce/svm/engine-artifacts` (Node only) locate the packaged programs; the program
  ids are `v12SvmEngineProgramId()` and `v12SvmKitchenProgramId()` from `/deployments`. Writing the
  programs is `sauce-solana`.
- **Intents** (`sauce-intents`): `routes.hashIntent(intent)` gives the three hashes,
  `routes.encodeRouteEvm(intent.route)` the route bytes (decode with `routes.EVM_ROUTE_PARAM` for
  `fulfill`), `destinationPot(chain)` the shared Pot and
  `routes.sauceEvmDeployPotCall({ owner: ecoRoutesExecutor(chain), salt: SAUCE_INTENT_POT_SALT })`
  its deploy; the intents runner builds a rehearsal with them. For the source side,
  `built.sourceTxs()` (`routes.intentSourceTxs` for an intent built some other way) is the
  funding and publication in order: a transfer of each reward token to the vault, then `publish`
  (`{ fundVia: "publishAndFund" }` for the approvals and `publishAndFund`). Pass `{ vault }` read with
  `routes.intentVaultAddressCall`: it is checked against `routes.predictIntentVault`, the package's
  own computation. `routes.publishTx`, `routes.publishAndFundTx`, `routes.approvalTxs` and
  `routes.isIntentFundedCall` build the single calls (`{ to, data }`, with `decode` for a read).
- **Nested intents** are written in the program: a body that opens the next intent with
  `Ethereum.Portal.send(...).receive(...).then(() => { ... })` (`sauce-intents`, Cascades). In a typed
  closure, `Base.Portal.send(reward, rewardOptions).receive(delivery, routeOptions).then(() => {
... Ethereum.Portal.send(...).receive(...).then(() => { ... }) })`, the inner chain is the
  imported export, which typechecks there. `routes.compileSauceProgram`
  lists the intents a program opens in `.intents`, and `routes.intentSourceTxs` publishes a fixed
  one from a wallet. The lower-level builder, `routes.openRoute(chain, body, options).nest(child,
{ via })`, attaches a child built in TypeScript instead, with options of its own: by default
  (`via: "transfer"`) the parent's route funds the child by a transfer into its vault, with no
  publication of its own; `via: "publishAndFund"` publishes and funds it for public discovery.

## Example

[examples/cook.mts](examples/cook.mts) builds the Pot, its deploy call and a cook with arguments
offline; [examples/compiler.mts](examples/compiler.mts),
[examples/actions.mts](examples/actions.mts) and [examples/verify.mts](examples/verify.mts) run the
raw compiler and argument codecs, the action-program pipeline, and settlement verification.
