# Protocols and tokens

[Documentation](../README.md) · [Quick start](quick-start.md) · [Coverage](../api/coverage.md)

Within an EVM route, token symbols and protocol names resolve against the destination chain:

```js
USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
```

`USDC` resolves to the chain's registered token address. `Uniswap.UniversalRouter` resolves to the registered contract address when used as an argument, and exposes its ABI methods when used as a call target. Amounts are integers in the token's smallest units; the SDK does not infer decimal conversions.

## Compile a global call

```ts
import { routes } from "@eco-incorp/sauce";

export function compileApproval(pot: routes.AddressInput, engine: routes.AddressInput) {
  return routes.compileSauceRoute("base", "USDC.approve(Uniswap.UniversalRouter, 1_000_000n);", {
    pot,
    engine,
  });
}
```

The returned `calls` encode an EVM Pot `cook`; this function does not submit a transaction. The same body can be a callback to `Base(() => { ... }, options).reward(...)`; see [creating intents](intents.md).

The supported Universal Router spelling is `UniswapV4.UniversalRouter`, or the unambiguous family alias `Uniswap.UniversalRouter`. `UniswapV3.UniversalRouter` is not registered. The router's `execute` method takes the arguments declared by its ABI; the namespace does not construct swap commands or select a route for you.

## Which names exist?

The protocol catalog, contract descriptors, token registry, and SVM venue registry provide different coverage. A catalog entry does not automatically provide a callable contract namespace. [Coverage](../api/coverage.md) lists what is registered.

```ts
import { contracts, getProtocol, routes } from "@eco-incorp/sauce";

const protocol = getProtocol("uniswap-v4");
const descriptors = contracts.listDescriptors();
const router = contracts.on("base").UniswapV4.UniversalRouter;
const baseTokens = routes.knownTokenSymbols(routes.chain("base").chain);

console.log(protocol, descriptors.length, router.available, baseTokens);
```

Contract accessors expose `address`, `available`, `chains`, `abi`, `methods`, and `coverage`. A namespace's presence does not establish deployment on every chain. A call to a registered contract with no deployment on the selected chain fails during construction or compilation.

Versioned names are explicit: `UniswapV2.Factory` and `UniswapV3.Factory` select different descriptors. A family alias only resolves a contract name when it identifies one descriptor; `Uniswap.Factory` is ambiguous and fails. A protocol with a single default contract also permits the shorter `Protocol.method(...)` form.

## Token methods and balances

These are SauceScript route-body fragments:

```js
USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
let available = USDC.balanceOf(self);
```

For a token absent from the registry, use `Token(address)`:

```js
Token(0x1111111111111111111111111111111111111111n).approve(Uniswap.UniversalRouter, 1_000_000n);
```

Replace that illustrative address with your ERC-20. The wrapper accepts a literal, a local variable, or a compile-time define. The token member syntax supports `transfer`, `approve`, and `balanceOf`. Use an explicit ABI binding for additional ERC-20 methods. The shorthand `self.USDC` reads the executing contract's balance; `USDC.balanceOf(self)` makes the same intent explicit. `self` refers to the executing contract, which is the Pot in the EVM route path.

Use `tokenDefines` on an intent to add or override symbols, or `tokens` on `compileSauceRoute`'s compile options. Overrides merge per symbol with the registry. These maps contain **addresses**; `IntentOptions.tokens` instead declares the **token amounts** a solver must deliver for the route.

```ts
import { routes } from "@eco-incorp/sauce";

export function compileCustomTokenApproval(
  pot: routes.AddressInput,
  engine: routes.AddressInput,
  asset: routes.AddressInput,
) {
  return routes.compileSauceRoute(
    "base",
    "ASSET.approve(Uniswap.UniversalRouter, 100n);",
    { pot, engine },
    { tokens: { ASSET: asset } },
  );
}
```

Custom symbol names work in source strings. The package's generated TypeScript declarations cover registered names; applications authoring callbacks with additional names must supply their own declarations. A declaration provides a type, while the token map provides the address used by the compiler.

## Route source and host JavaScript

Two different mechanisms share the look of a bare name, and the difference is what you import.

Chain accessors such as `Base` and `Solana`, the `chain(ref)` front door, and the host `Token` builder are **named exports**: `import { Base, Solana, Token } from "@eco-incorp/sauce"`. They are ordinary JavaScript values, and importing the package installs nothing on `globalThis`.

Bare route names such as `USDC` and `Uniswap` are **route syntax**, resolved by the compiler against the destination chain. The package supplies TypeScript declarations for them so a typed callback checks, but there is no host JavaScript `USDC` or `Uniswap` object to import or execute.

A host that wants the chain names as runtime globals anyway can opt in with `installRouteGlobals()`, which defines them on `globalThis` (or any target you pass) and never overwrites a name already there. It installs values only; declare the names yourself.

Outside a route, `Base.UniswapV4.UniversalRouter` or `contracts.on("base").UniswapV4.UniversalRouter` is a real host accessor. Its methods return inert `ContractCall` objects. A call can provide encoded `data`, `.toCall()` for `{ target, data, value }`, or `.toSauceScript()` for source and import paths. Host accessor methods currently have the static type `unknown`; use an explicit signature when invoking one in TypeScript:

```ts
import { contracts } from "@eco-incorp/sauce";

const router = contracts.on("base").UniswapV4.UniversalRouter;
const execute = router.execute as (
  commands: `0x${string}`,
  inputs: readonly `0x${string}`[],
  deadline: bigint,
) => contracts.ContractCall;
```

That declaration does not build or send a swap. Supply valid Universal Router commands before calling it. For ordinary ERC-20 operations from host code, the typed `token.Token.transfer({ ... })` and `.approve({ ... })` builders are usually more convenient; see [builders and actions](builders-and-actions.md).

## Chain selection and ABI bindings

A bare protocol reference uses the enclosing destination. A qualified reference such as `Ethereum.UniswapV4.UniversalRouter` selects an address from Ethereum's registry. It does **not** move execution to Ethereum: the resulting call still executes on the enclosing route's chain. Use separate intents and [nesting](nested-intents.md) for cross-chain execution. Set `compile.accessors.chainScope` to restrict explicitly qualified chain names when needed.

Route rewriting rejects missing methods, ambiguous aliases, missing deployments, and descriptors marked with widened ABI types. A widened ABI can produce a selector different from the deployed contract. Inspect `coverage` and use the exact ABI for that deployment; opting past the check does not repair the ABI.

To call a contract outside the descriptor registry, supply an ABI binding through `compile.contracts` or a resolved ABI import, then call `Binding.at(address).method(...)` in source. See [compiler integration](../api/compiler.md). Host `.at(address)` rebinding and SauceScript ABI `.at(address)` are separate APIs; the global protocol rewrite does not provide arbitrary `.at(...)` chains.

The token and EVM protocol rewrites apply to EVM routes. Solana uses account parameters and venue adapters, covered in the [Solana guide](solana.md).
