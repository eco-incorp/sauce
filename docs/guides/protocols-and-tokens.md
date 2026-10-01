# Protocols and tokens

[Documentation](../README.md) · [Quick start](quick-start.md) · [Coverage](../api/coverage.md)

Inside an EVM route body, token symbols and protocol contracts are names the compiler resolves
against the destination chain — so a program reads like the operation it performs:

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

Contract accessors expose `address`, `available`, `chains`, `abi`, `methods` and `coverage`. A name
existing does not mean the contract is deployed on your chain — calling one that is not fails when
you build or compile, which is the point at which you can still do something about it.

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

Replace that illustrative address with your ERC-20. The wrapper accepts a literal, a local variable, or a compile-time define. It can also be bound once and called, `const t = Token(address); t.approve(spender, amount);`, as long as `t` is never reassigned or used other than as `t.<method>(...)`. The token member syntax supports `transfer`, `approve`, `transferFrom`, and `balanceOf`. Use an explicit ABI binding for additional ERC-20 methods. The shorthand `self.USDC` reads the executing contract's balance; `USDC.balanceOf(self)` makes the same intent explicit. `self` refers to the executing contract, which is the Pot in the EVM route path.

### Writes follow SafeERC20

`transfer`, `approve` and `transferFrom` have OpenZeppelin `SafeERC20` semantics however you spell
them: `USDC.transfer(to, amount)`, `Token(address).transfer(to, amount)`, a bound `t.transfer(...)`,
or the `@sauce/token` function `transfer(token, to, amount)`. The first three compile to exactly the
fourth, so they are one implementation, not four. A token that returns nothing, such as USDT, is
accepted when it has code. A `false` return, a malformed return, or an address with no code reverts
the program. `approve` resets a non-zero allowance to zero before setting the new one, as
`forceApprove` does, because USDT refuses to change one non-zero allowance to another.

A write returns nothing: it succeeds or reverts the program, so there is no `bool` to read, and
`const ok = USDC.transfer(...)` does not compile. Each write lowers to `@sauce/token` imported under
a reserved `__sauce_<method>` name, so a program's own `transfer` or `approve` function keeps its
name.

An explicit `IERC20.at(address).transfer(...)`, with the ABI imported yourself, is **not** SafeERC20.
It is the raw ABI call: it decodes the declared `bool`, so it reverts on a token that returns nothing
and accepts one that returns `false`. Use it only when that is the behavior you want; otherwise use
one of the spellings above.

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

### Pulling tokens in

A program that spends tokens its Pot does not hold yet can pull them from the account that does,
with three more `@sauce/token` functions (EVM). Each pull is a `safeTransferFrom`, however it is
authorised:

- `transferFrom(token, owner, ctx.self(), amount)`, on an allowance `owner` gave the Pot: the
  SafeERC20 write above.
- `permit(token, owner, spender, value, deadline, v, r, s)` sets that allowance from `owner`'s
  EIP-2612 signature; the same `transferFrom` then pulls. As OpenZeppelin's `safePermit` does, it
  requires the token's nonce for `owner` to move by exactly one, so a token with no `permit` whose
  fallback accepts any call (WETH9's does) is refused rather than taken for one that granted the
  allowance.
- `permitTransferFrom(token, owner, amount, nonce, deadline, signature, permit2)` spends `owner`'s
  Permit2 signature for `amount` of `token` to the program. The program (`ctx.self()`) is the
  spender the signature must name, and `permit2` is the Permit2 deployment, `Permit2.Permit2` in a
  route body. Permit2 spends the nonce, refuses a passed deadline, and moves the tokens with
  Solmate's `SafeTransferLib.safeTransferFrom`: a token that returns nothing works, and one that
  returns `false` reverts the program.

```ts
import { permitTransferFrom } from "@sauce/token";

function main(
  owner: Address,
  amount: Uint256,
  nonce: Uint256,
  deadline: Uint256,
  signature: bytes,
) {
  permitTransferFrom(USDC, owner, amount, nonce, deadline, signature, Permit2.Permit2);
  USDC.transfer(0x6666666666666666666666666666666666666666n, amount);
}
```

The Permit2 signature is EIP-712 over `PermitTransferFrom(TokenPermissions permitted, address
spender, uint256 nonce, uint256 deadline)`, with `TokenPermissions(address token, uint256 amount)`,
in Permit2's domain: name `Permit2`, the chain id, and Permit2's address. Permit2's nonces are
unordered: any unused one will do. The `sauce` command's `run --fund` makes the signature and the
pull for you ([Funding a run](cli.md#funding-a-run---fund)).

## Route source and host JavaScript

Two different mechanisms share the look of a bare name, and the difference is what you import.

Chain accessors such as `Base` and `Solana`, the `chain(ref)` front door, and the host `Token` builder are **named exports**: `import { Base, Solana, Token } from "@eco-incorp/sauce"`. They are ordinary JavaScript values, and importing the package installs nothing on `globalThis`.

Bare route names such as `USDC` and `Uniswap` are **route syntax**, resolved by the compiler against the destination chain. The package supplies TypeScript declarations for them so a typed callback checks, but there is no host JavaScript `USDC` or `Uniswap` object to import or execute.

A host that wants the chain names as runtime globals anyway can opt in with `installRouteGlobals()`, which defines them on `globalThis` (or any target you pass) and never overwrites a name already there. It installs values only; declare the names yourself.

Outside a route, `Base.UniswapV4.UniversalRouter` or `contracts.on("base").UniswapV4.UniversalRouter` is a real host accessor. Its methods return inert `ContractCall` objects. A call can provide encoded `data`, `.toCall()` for `{ target, data, value }`, or `.toSauceScript()` for source and import paths. A host accessor's methods are typed `unknown`, because their signatures come from an ABI the type
system has not seen. Narrow one before calling it:

```ts
import { contracts } from "@eco-incorp/sauce";

const router = contracts.on("base").UniswapV4.UniversalRouter;
const execute = router.execute as (
  commands: `0x${string}`,
  inputs: readonly `0x${string}`[],
  deadline: bigint,
) => contracts.ContractCall;
```

That declaration does not build or send a swap. Supply valid Universal Router commands before calling it. For ordinary ERC-20 operations from host code, the typed `token.Token.transfer({ ... })` and `.approve({ ... })` builders are usually more convenient; see [builders](builders-and-actions.md).

## Chain selection and ABI bindings

A bare protocol reference uses the enclosing destination. A qualified reference such as `Ethereum.UniswapV4.UniversalRouter` selects an address from Ethereum's registry. It does **not** move execution to Ethereum: the resulting call still executes on the enclosing route's chain. Use separate intents and [nesting](nested-intents.md) for cross-chain execution. Set `compile.accessors.chainScope` to restrict explicitly qualified chain names when needed.

Route rewriting rejects missing methods, ambiguous aliases and missing deployments. Every descriptor declares its contract's deployed ABI types, so the selectors it computes are the ones the deployed contract dispatches.

To call a contract outside the descriptor registry, supply an ABI binding through `compile.contracts` or a resolved ABI import, then call `Binding.at(address).method(...)` in source. See [compiler integration](../api/compiler.md). Host `.at(address)` rebinding and SauceScript ABI `.at(address)` are separate APIs; the global protocol rewrite does not provide arbitrary `.at(...)` chains.

The token and EVM protocol rewrites apply to EVM routes. Solana uses account parameters and venue adapters, covered in the [Solana guide](solana.md).
