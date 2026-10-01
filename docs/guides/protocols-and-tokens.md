# Protocols and tokens

[Documentation](../README.md) · [Quick start](quick-start.md) · [Coverage](../api/coverage.md)

Every protocol in the registry is a namespace, and every registered token a name, in both languages
the SDK speaks. Inside a program they are names the compiler resolves against the chain the program
runs on:

```js
USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
```

In host TypeScript the same names hang off a chain export:

```ts
import { Base } from "@eco-incorp/sauce";

Base.USDC.address; // the address `USDC` resolves to in a program compiled for Base
Base.UniswapV4.UniversalRouter.address; // the address `UniswapV4.UniversalRouter` resolves to there
```

`USDC` resolves to the chain's registered token address. `Uniswap.UniversalRouter` resolves to the
registered contract address when used as a value, and exposes its ABI methods when used as a call
target. Amounts are integers in the token's smallest units; the SDK does not infer decimal
conversions.

### Tokenized stocks

Ethereum and Base also register tokenized stocks, named the same way: `SPCXc.balanceOf(...)` reads
Coinbase's SpaceX token on Base, and `Base.SPCXc.address` is its address. Ethereum has Backed's
xStocks (`TSLAx`, `SPCXx`) and bTokens (`bTSLA`) and Ondo Global Markets' tokens (`TSLAon`,
`SPCXon`); Base has Coinbase's (`TSLAc`, `SPCXc`) and Backed's bTokens. A symbol is the issuer's
own ticker for the token, case-sensitive, with a `.` written `_` (`BRK_Bx`). Each row of
`routes.TOKEN_REGISTRY` that is a stock carries `stock`: its issuer, its name and the underlying's
ticker. `sauce globals --chain <chain> --stocks` lists a chain's, and `--search <text>` finds one
by symbol, company name or ticker. [What is registered](../api/coverage.md#tokenized-stocks) counts
them and says how they differ from a plain ERC-20.

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

## Namespaces

A protocol's namespace is its registry slug in PascalCase: `uniswap-v3` is `UniswapV3`,
`aerodrome-slipstream` is `AerodromeSlipstream`, `pancakeswap-v3` is `PancakeswapV3`. Its members
are the contracts the registry evidences against the deployed code, one per contract:

| Member              | Example                                        | In a program                         | In TypeScript                                         |
| ------------------- | ---------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| A deployed contract | `PancakeswapV3.Factory`, `UniswapV4.StateView` | its address; `.method(...)` calls it | `.address`, `.available`, `.method(...)` builds calls |
| An address only     | `AaveV3.PoolAddressesProvider`, `Maker.Dai`    | its address                          | `.address`, `.available`; no methods                  |
| An interface        | `Erc4626.Vault`, `Curve.StableSwap`            | `.at(address).method(...)`           | `.at(address).method(...)`                            |

A deployed contract's ABI also reaches another deployment of it with `.at(address)`:
`UniswapV3.Factory.at(factory).getPool(...)`. An address-only contract is one the registry has an
address for and no verified ABI. An interface is an ABI the registry has no fixed address for —
a vault, a pool, a token — so the program or host names the deployment.

### Names

- **A contract is named by its role** in the protocol's `addresses.ts`, first letter upper-cased:
  `quoterV2` is `QuoterV2`, `cUSDCv3` is `CUSDCv3`. Where the role's leading words also appear in
  its ABI's name, they keep the ABI's spelling: `clFactory`, whose ABI is `SlipstreamCLFactoryABI`,
  is `AerodromeSlipstream.CLFactory`.
- **An interface is named by its ABI**, without `ABI` and the protocol's own prefix:
  `ERC20ABI` is `Erc20.ERC20`, ERC-4626's `VaultABI` is `Erc4626.Vault`. So is a role that runs
  different ABIs on different chains (Gamma's `UniProxy` and `UniProxyLegacy`).
- **A family alias** groups a protocol's versions: a slug ending in `-v<N>` also joins the family
  named by the rest, so `Uniswap` covers `UniswapV2`, `UniswapV3` and `UniswapV4`, and `Aave`,
  `Compound`, `Pancakeswap`, `Gmx` and the others theirs. A family exposes a contract only when
  exactly one member has one by that name: `Uniswap.UniversalRouter` is `UniswapV4.UniversalRouter`,
  while `Uniswap.Factory` names both V2's and V3's and is refused, never guessed — in a program at
  compile time, in TypeScript as a type error and a thrown error. A family alias always takes a
  contract name.
- **A protocol with one deployed contract** also takes its methods directly:
  `Cctp.depositForBurn(...)` is `Cctp.TokenMessenger.depositForBurn(...)`. This shortcut exists in
  programs only.

A name existing does not mean the contract is deployed on your chain. Naming one that is not fails
when the program compiles, or when TypeScript builds the call — the point at which you can still do
something about it. [Coverage](../api/coverage.md) has the totals, and
`contracts.listContracts(slug)` lists a protocol's contracts.

## Use a venue only where the chain has it

`available(<name>)` asks, when the program is compiled, whether the chain it is compiled for has a
contract or a token. A branch it rules out is removed before any name in it is resolved, so one
program can name a venue some of its chains lack:

```js
// One program for every chain: the USDC/WETH 0.05% pool from PancakeSwap V3 where the chain has it,
// from Uniswap V3 where it does not, and nothing where it has neither.
//
// `available(...)` is decided when the program is compiled, for the chain it is compiled for, and
// the branches it rules out are removed before anything in them is resolved.
function main() {
  let pool = 0n;
  if (available(PancakeswapV3.Factory)) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
  } else if (available(UniswapV3.Factory)) {
    pool = UniswapV3.Factory.getPool(USDC, WETH, 500n);
  }
  return pool;
}
```

Compiled for Base this calls PancakeSwap V3's factory; compiled for Optimism, which has no
PancakeSwap V3, it compiles to the Uniswap V3 lookup alone. [registry-names.ts](../examples/registry-names.ts)
compiles it for both.

- It takes a contract — `UniswapV3.Factory`, `Uniswap.UniversalRouter`, or one on a named chain,
  `Arbitrum.UniswapV3.Factory` — or a token symbol, `USDT`. A token is available where the chain's
  token map has it, which includes the `tokens` you pass.
- It folds `if`/`else`, `?:`, `&&`, `||` and `!`. A guard that returns,
  `if (!available(X)) return 0n;`, removes the rest of its block where `X` is absent.
- Anywhere else it is the literal `true` or `false`. A branch that depends on it only through a
  runtime value (`const has = available(X); if (has) ...`) is live code, and every name in it must
  still resolve.
- A name the registry does not know on any chain is an error, not `false`, as are an ambiguous
  family name and an interface, so a typo cannot quietly drop a branch. A program that declares its
  own `available` keeps it.
- Inside an intent to another chain, `Arbitrum(() => { ... })`, it is decided for that chain.

In TypeScript, the same question is a contract's `.available`, and whether the chain export has the
token: `Optimism.PancakeswapV3.Factory.available` is `false`, and `Celo.USDC` is a type error.

A name used as a token or a protocol that the chain does not have at all fails when the program
compiles, naming it and the chain's closest names: `USDCC.balanceOf(...)` on Base reports
"`USDCC` is not a token or protocol on base. Did you mean `USDC`?".

## Token methods and balances

These are SauceScript route-body fragments:

```js
USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
let balance = USDC.balanceOf(self);
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

The raw ABI call is **not** SafeERC20: `Erc20.ERC20.at(address).transfer(...)`, or
`IERC20.at(address).transfer(...)` with the ABI imported yourself, decodes the declared `bool`, so it
reverts on a token that returns nothing and accepts one that returns `false`. Use it only when that
is the behavior you want; otherwise use one of the spellings above.

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

Bare route names such as `USDC`, `Uniswap` and `available` are **route syntax**, resolved by the compiler against the destination chain. The package supplies TypeScript declarations for them so a typed callback checks, but there is no host JavaScript `USDC` or `Uniswap` object to import or execute. The host spelling of the same registry entry is on the chain export: `Base.USDC`, `Base.Uniswap`.

A host that wants the chain names as runtime globals anyway can opt in with `installRouteGlobals()`, which defines them on `globalThis` (or any target you pass) and never overwrites a name already there. It installs values only; declare the names yourself.

## Contracts and tokens from TypeScript

A chain export carries the registry for its chain. A token is its registry row:

```ts
import { Base } from "@eco-incorp/sauce";

const { address, decimals, symbol, chain } = Base.USDC;
```

A contract's methods build calls, typed from its ABI: the arguments are the ABI's, and a call
carries its encoded `data`, `.toCall()` for `{ target, data, value }` and `.toSauceScript()` for the
same call as a program. Run one against a client you pass — the SDK embeds no RPC endpoint and reads
no environment:

```ts
import { Base } from "@eco-incorp/sauce";
import type { PublicClient, WalletClient } from "viem";

export async function quoteAndSwap(publicClient: PublicClient, walletClient: WalletClient) {
  const [amountOut] = await Base.UniswapV3.QuoterV2.quoteExactInputSingle({
    tokenIn: Base.USDC.address,
    tokenOut: Base.WETH.address,
    amountIn: 1_000_000n,
    fee: 500,
    sqrtPriceLimitX96: 0n,
  }).read(publicClient);

  const swap = Base.UniswapV3.SwapRouter02.exactInputSingle({
    tokenIn: Base.USDC.address,
    tokenOut: Base.WETH.address,
    fee: 500,
    recipient: walletClient.account!.address,
    amountIn: 1_000_000n,
    amountOutMinimum: (amountOut * 99n) / 100n,
    sqrtPriceLimitX96: 0n,
  });
  await swap.simulate(publicClient, { account: walletClient.account! });
  return swap.write(walletClient);
}
```

- `read(client)` runs the method as an `eth_call` and resolves to its decoded outputs: a view's
  value, or what a state-changing method would return with nothing sent. Uniswap's QuoterV2 quotes
  are state-changing methods meant to be read this way.
- `simulate(client, { account, value? })` runs a state-changing method as `account` and resolves
  to viem's `{ result, request }`.
- `write(client, { account?, value? })` sends a state-changing method from the wallet client's
  account and resolves to the transaction hash. A view or pure method's call has no `simulate` or
  `write`.

Each first checks that the client is on the call's chain, because the address is that chain's
deployment. viem's actions load on the first such call, not when the call is built. The swap above
also needs the router's allowance for `USDC` first: an interface bound to the token,
`Base.Erc20.ERC20.at(Base.USDC.address).approve(router, amount)`, builds it, as do the
[token builders](builders-and-actions.md).

`contracts.on("base")` returns the same tree for a chain chosen at run time. The [contracts
reference](../api/contracts.md) lists every property and option.

## Chain selection and ABI bindings

A bare protocol reference uses the enclosing destination. A qualified reference such as `Ethereum.UniswapV4.UniversalRouter` selects an address from Ethereum's registry. It does **not** move execution to Ethereum: the resulting call still executes on the enclosing route's chain. Use separate intents and [nesting](nested-intents.md) for cross-chain execution. Set `compile.accessors.chainScope` to restrict explicitly qualified chain names when needed.

Route rewriting rejects missing methods, ambiguous aliases and missing deployments. Every registry ABI declares its contract's deployed types, so the selectors it computes are the ones the deployed contract dispatches.

To call a contract outside the registry, supply an ABI binding through `compile.contracts` or a resolved ABI import, then call `Binding.at(address).method(...)` in source. See [compiler integration](../api/compiler.md).

The token and EVM protocol rewrites apply to EVM routes. Solana uses account parameters and venue adapters, covered in the [Solana guide](solana.md).
