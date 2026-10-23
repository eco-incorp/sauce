# Programs and cooks

**Reference** · [Documentation](../README.md) · [API reference](README.md) · [Compiler](compiler.md)

> This is the reference for compiling a program for one chain by name and for building the
> transaction that runs it on a Pot: `compileSauceProgram`, `encodeEntryArguments`, the cook builders
> and the Pot helpers. The [compiler](compiler.md) page covers the raw `compile()` underneath.

It is for TypeScript developers with the package installed. `routes` is a namespace of the package
root, next to the chains you use; the Pot helpers are root exports and the cook encoders live in
subpaths:

```ts
import { routes, v12PredictPot, potSalt, DEFAULT_POT_SALT } from "@eco-incorp/sauce";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { v12EngineAddress, v12KitchenAddress } from "@eco-incorp/sauce/deployments";
```

There is no `/routes` subpath. The public types are members of the namespace:
`routes.CompiledSauceProgram`, `routes.SauceProgramOptions`, `routes.SauceEvmCall`, and so on.

## Compile a program for one chain

`routes.compileSauceProgram(chain, source, options?)` compiles a SauceScript file for the chain
named by a slug, an alias, a numeric chain id or a canonical chain record. The source is a module
declaring `function main(...)`, or a script whose top-level statements are the entry. A script
cannot `return`, so a program that returns a value declares `main`.

```ts
import { routes } from "@eco-incorp/sauce";

const program = routes.compileSauceProgram("base", "function main() { return 7; }");
```

The program gets the chain's names with no import: its token symbols (`USDC`), protocol namespaces
(`UniswapV3.Factory`), `chainId`, and the `@sauce/token` functions. One source therefore compiles,
unchanged, for every chain where its names exist; a name the chain lacks fails the compile. The
result is a `CompiledSauceProgram`:

| Field                              | Contents                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `chain`                            | The canonical chain record                                                                          |
| `bytecode`                         | The program, a `Uint8Array`                                                                         |
| `entryEncoding`                    | Always `"abi-v1"`                                                                                   |
| `entryParams`                      | `main`'s run-time parameters in order, each `{ name, type }`; on Solana without the `Account` slots |
| `manifest`                         | On Solana, the accounts to attach, in order. Absent on EVM                                          |
| `derivedAccounts`, `derivedValues` | On Solana, the accounts and `Uint256` values the SDK added to `main`, and how each is worked out    |
| `stoppable`, `stoppableRuns`       | On Solana, the venue swaps at a price that a stop could hold, and how often each runs               |
| `source`                           | The source after the SDK's token and protocol rewrites                                              |

`SauceProgramOptions` are `SauceCompileOptions` plus two fields:

- `args` binds `main`'s arguments into the program as constants, in order. Each must be one word: an
  integer (`Uint256` or `Int256`), an address or a `bool`. The program then takes none at run time. Leave it out to
  compile `main` taking its arguments as it runs. A bound `Uint256`, `Address` or `bool` holds its
  value in the whole program, so it may not share its name with anything the module declares or
  with one of the chain's values (a token symbol, `chainId`, a protocol address): that is refused.
  A bound `Int256` is a local of `main`.
- `stops`, on Solana, names the venue swaps at a price to hold to a stop, each by its derivation
  from `stoppable`.

`SauceCompileOptions` supports:

- `target`, which defaults by chain kind: `"v12"` for an EVM chain and `"svm"` for Solana. `"v1"` and
  `"v12"` both select the EVM backend.
- `resolve` and `resolvePackage`, for the program's own imports. `resolve` has the
  [compiler's resolver contract](compiler.md#resolver-contract) and is asked for any path the
  program imports. The SDK itself serves `@sauce/token`, `./artifacts/IERC20.json`,
  `./artifacts/ISauceRouter.json` and every `./protocols/<slug>/<Export>.json`, so source from the
  SDK's builders needs neither option.
- Scalar `defines`, token-address `tokens` overrides (merged per symbol with the registry), ABI
  `contracts` and `ambient` module names.
- `accessors`. Accessor rewriting defaults on; an options object can configure qualified-chain
  scope or other rewrite behavior.
- Raw [`compile()`](compiler.md) additionally exposes `entryKind`, scalar `args`, `cache` and `optimize`.

## Arguments a program takes at run time

A typed `main` takes values at run time. `routes.encodeEntryArguments(program, values)` checks each
value against the type `main` declares, in order, and encodes them the way the program was compiled
to read them. It throws, naming the parameter, on a wrong count or a value of the wrong type.
Append the result to the bytecode: that whole payload is the `program` of the cook.

```ts
import { routes } from "@eco-incorp/sauce";

const source = "function main(to: Address, amount: Uint256) { USDC.transfer(to, amount); }";
const program = routes.compileSauceProgram("base", source);

const args = routes.encodeEntryArguments(program, [
  "0x4444444444444444444444444444444444444444",
  1_000_000n,
]);
const payload = new Uint8Array([...program.bytecode, ...args]);
```

A value is a `bigint`, a safe-integer `number` or an integer string for a scalar, hex for an address,
a `boolean` for a `bool`, a `Uint8Array` or hex for `bytes`, an array for an array, and an array of
the fields in order or an object naming them for a tuple. `routes.decodeEntryArguments` is the
reverse. Pass `args` in the options instead to fix the values when the program is compiled.

## Build a cook

A cook is `Pot.cook(engine, program)`, so building one needs a Pot, an engine and the program's
bytes.

`routes.buildSauceEvmCall({ pot, engine, program, value? })` builds one Pot `cook` call; `program` is
a hex string. `value` defaults to zero and must include the Kitchen fee. `routes.buildSauceEvmCalls({
pot, engine, cooks, value? })` returns one call per hex program in `cooks`, in order, applying that
value to **each**. Multiple statements within one program need only one cook and one fee.

```ts
import { routes, v12PredictPot } from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { toHex, type Hex } from "viem";

const owner = "0x4444444444444444444444444444444444444444";

const call = routes.buildSauceEvmCall({
  pot: v12PredictPot(owner),
  engine: v12EngineAddress() as Hex,
  program: toHex(payload),
  value: 1_000n, // the Kitchen fee, read just before building
});
// { to, target, data, value }
```

Every builder here, and `sauceEvmDeployPotCall` below, returns `{ to, target, data, value }`.
`{ to, data, value }` is the request a wallet sends or `client.call` takes, the same shape as
`kitchenExecutionFee()`; `to` is the contract's checksummed 20-byte address. `target` names the
same contract as a call record does: from the cook builders, the Pot as a 32-byte, lowercase,
left-padded address; from `sauceEvmDeployPotCall`, the Kitchen as you gave it (the released one's
address when you gave none). `value` is a `bigint`.

`v12Pot.encodeCook(engine, program)` from `@eco-incorp/sauce/evm/engine` is the calldata encoder
underneath: it returns the `cook(engine, program)` calldata as hex. It throws for an engine that the
pinned release sets pair with another compiler than the SDK's.

`routes.compileSauceRoute(chain, source, execution, options?)` compiles a source and builds that one
call in a single step. `execution` is `{ pot, engine, value? }` on an EVM chain. It returns
`{ calls, compiled, source }`: `calls` holds the one cook call, `compiled` a result with `bytecode:
Uint8Array[]` and an empty `warnings` array, and `source` the rewritten program. It gives the program
the chain's token symbols and the registry rewrites, but neither `chainId`/`CHAIN_ID` nor the
`@sauce/token` functions with no import: pass `chainId` in `defines` and import `@sauce/token`
instead. It takes no run-time arguments, and keeps neither the entry schema nor the Solana manifest.
Use `compileSauceProgram` when you need any of those.

`buildSauceSvmCall` and an SVM `compileSauceRoute` emit an 8-byte engine instruction that the Solana
engine does not accept, whatever code account or engine id you give them: they do not build the
Kitchen call the engine requires. Build Solana execution with the Kitchen client instead; see
[Solana from TypeScript](../guides/solana-from-typescript.md).

## Find and deploy a Pot

For an EVM Kitchen release, a Pot is fixed by its Kitchen, Pot init-code hash, owner and salt.
Its address is arithmetic you can do without a chain; a release with different Pot code derives
a different address for the same owner and salt.

| Export                                                    | From           | Does                                                                                                |
| --------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `v12PredictPot(owner, salt?, kitchen?)`                   | `.`            | The Pot's CREATE2 address. `salt` defaults to `DEFAULT_POT_SALT`, `kitchen` to the released Kitchen |
| `DEFAULT_POT_SALT`                                        | `.`            | Every owner's default Pot salt: zero bytes32, `0x00…00`                                             |
| `potSalt(label)`                                          | `.`            | The salt of the Pot an owner names `label`: `keccak256` of its UTF-8 bytes. An empty label throws   |
| `routes.sauceEvmDeployPotCall({ owner, salt, kitchen? })` | `.`            | The Kitchen's `deployPot(owner, salt)` call, by default through the released Kitchen                |
| `v12EngineAddress()`                                      | `/deployments` | The released engine's address                                                                       |
| `v12KitchenAddress()`                                     | `/deployments` | The released Kitchen's address                                                                      |
| `kitchenExecutionFee(kitchen?)`                           | `.`            | A request and decoder for the Kitchen's `executionFee()`; it reads no chain                         |

An owner has one Pot per salt. The zero salt is the convention for the Pot an owner has by default,
and a label names any other: `v12PredictPot(owner, potSalt("treasury"))`. To use an exact salt,
pass its 32 bytes as they are.

```ts
import { routes, v12PredictPot, potSalt } from "@eco-incorp/sauce";

const owner = "0x4444444444444444444444444444444444444444";
const salt = potSalt("treasury");

const pot = v12PredictPot(owner, salt);
const deploy = routes.sauceEvmDeployPotCall({ owner, salt });
```

Deriving is not deploying. The address exists as soon as you know the owner; the contract exists once
somebody has called the Kitchen's `deployPot`, a call anyone can make once for each owner and salt.
Send `deploy` before the first cook on a Pot that may not exist yet.

Every address helper here returns a **recorded** address, never a verified one. `v12EngineAddress()`
and `v12KitchenAddress()` give the released addresses, the same on every chain; the SDK reads no
chain, so it cannot say whether code is there. Check the chain before trusting any of them;
[prepare-pot.ts](../examples/prepare-pot.ts) shows prediction, deployment and the owner and
Kitchen checks. A Pot's bytecode is part of its address, so a Kitchen release that changes that
bytecode gives the same owner and salt a new Pot, and a Pot of an earlier release keeps running on the
engine built for it.

On Arc, native value is USDC at 18 decimals, drawn from the same balance as the USDC ERC-20; see
[Arc: USDC is the native coin](../reference/chains/arc.md#notes).

## Also in the namespace

| Export                                                                       | Holds                                                                      |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `routes.chain(ref)`, `routes.chainAccessors.Base`                            | A chain's bare namespace, carrying `.chain` alone, by reference or by name |
| `routes.sourceGlobals(chain)`                                                | The names a program may use on a chain, as `sauce globals` prints them     |
| `routes.TOKEN_REGISTRY`, `routes.knownTokenSymbols`, `routes.registryTokens` | The token registry; see [coverage](coverage.md)                            |
| `routes.SVM_TOKEN_REGISTRY`                                                  | The Solana token registry                                                  |
| `routes.toUniversalAddress`, `routes.denormalizeToEvm`                       | Normalize an address to its 32-byte form, and an EVM one back to 20 bytes  |

`Base`, `Solana` and every other chain are named exports of the package root, and they hold registry
names and contract accessors, described in the [contracts reference](contracts.md). They are not
callable, and importing the package installs nothing on `globalThis`.

## Next

- Compile standalone programs, resolve their imports and encode arguments: [compiler](compiler.md).
- Call protocols and tokens by name from TypeScript: [contracts and tokens](contracts.md).
