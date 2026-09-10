# Sauce

**Sauce** — build, compile and verify Sauce programs: cross-chain intents whose programs execute as
bytecode on the Eco Pot. One TypeScript package for EVM and SVM. Published as `@eco-incorp/sauce`.

```sh
npm install @eco-incorp/sauce
```

> The runtime **engine** (the on-chain interpreter these programs execute on) lives in the separate
> `eco-incorp/v12` repo. This repo — `eco-incorp/sauce` — is the developer-facing Sauce package that
> _targets_ it.

**Node only.** The compiler is loaded through `createRequire` (its `node` build is CommonJS reading a
sibling `.wasm` off disk), and the route path imports `node:fs`/`node:path`, so the Quickstart, the
builders and `/compiler` all require a Node runtime. The registry and decoding subpaths import no
Node builtin and work anywhere: `/verify`, `/chains`, `/deployments`, `/protocols/*`, `/evm/engine`
and `/svm/engine`. The
compiler package does ship a browser build, but this package does not expose it.

The SauceScript compiler comes with it as a dependency. There are no optional peers.

## Quickstart

Open a route on a destination chain, and the SDK compiles the program and assembles the intent:

```ts
import { routes } from "@eco-incorp/sauce";

// Both deadlines are ABSOLUTE unix timestamps, not durations: the chain compares
// `block.timestamp > route.deadline`. And rewardDeadline must be >= deadline — a solver may fulfil
// right up to the route deadline, so an earlier reward deadline is already refundable by then.
// pot, portal, sourcePortal, creator and prover are addresses for YOUR deployment; the package
// ships no defaults for those. Token addresses it does ship — see the registry note below.
const now = BigInt(Math.floor(Date.now() / 1000));

const built = routes
  .openRoute("base", "function main() { return 1n; }", {
    source: "ethereum", // the SOURCE chain — where the reward is posted
    pot, // the Pot on the destination chain, which runs the program
    portal, // the DESTINATION Portal — lands in route.portal
    sourcePortal, // the SOURCE Portal — where the intent is published
    creator,
    prover,
    deadline: now + 3600n,
    rewardDeadline: now + 7200n,
  })
  .reward([{ token: usdc, amount: 1_000_000n }]);

built.compiled.bytecode[0]; // the program
built.intent; // the assembled Intent
built.publishCalldata(); // calldata for sourcePortal — omit sourcePortal above and this throws
```

Common token addresses are already there: `routes.TOKEN_REGISTRY` carries probe-verified `USDC` and
`WETH` for ethereum, optimism, polygon, base and arbitrum, the wrapped native under whatever symbol
it actually reports (polygon's is `WPOL`), and `USDT` on ethereum and optimism only. `USDT` is absent
elsewhere because a row is registered under a ticker only when the deployed contract's own `symbol()`
string-equals it: the Tether-migrated polygon and arbitrum deployments return `USDT0`/`USD₮0` and
fail that gate, and base's was never probed. So a missing row means "not provenance-verified under
that ticker", NOT "not deployed" — `tokenDefines` overrides any key when you want one anyway.
Ask `routes.knownTokenSymbols(requireChain('polygon'))` for what a chain actually carries. Look one up
with `routes.registryTokenAddress(requireChain('base'), 'USDC')` (`requireChain` is a root export --
see [Registries](#registries)), which returns a **`bigint`**, or `undefined` when that chain does not
carry the symbol -- not a `0x` string, so format it yourself if you need one:
`'0x' + address.toString(16).padStart(40, '0')` gives base USDC as
`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`. `openRoute` also folds them in as
ambient defines, so a route body can write `USDC.transfer(to, amount)` with no configuration at all.

`routes.openRoute(destination, …)` is what the chain globals forward to, so
`Base(sauce, options).reward(…)` is the same call. Those globals are installed on `globalThis` as a
side effect of importing the package — they are **not** exports, so `import { Base }` fails. Opt out by setting `globalThis.__ECO_ROUTES_NO_GLOBALS__ = true` **before the first import** — it is
read at module evaluation, so setting it afterwards is too late and silently does nothing. After the
fact, `uninstallRouteGlobals()` is the one that works. Or just use `routes.openRoute` and ignore
them.

`.reward()` takes a token-amount array as above. A **bare bigint** is a NATIVE reward —
`.reward(1_000_000n)` posts 1e6 wei of the source chain's gas token, not 1 USDC.

> **Route bodies are unannotated SauceScript.** The SDK runs source rewrites over the body before
> compiling, and those parse plain JS — `function main(): Uint256 { … }` is rejected. Annotated
> SauceScript is fine when you call the compiler directly (below), just not through a route.

## Building programs without writing SauceScript

The `token`, `swap` and `deposit` namespaces emit SauceScript for you. `token` returns the source
and its base dirs together; `swap` and `deposit` return a bare string, with base dirs as separate
constants:

```ts
import { routes, token } from "@eco-incorp/sauce";

// toSauceScript returns the baseDirs the program's own imports need, alongside the source
const { source, baseDirs } = token.Token.transfer({
  token: usdc,
  to: recipient,
  amount: 1_000_000n,
}).toSauceScript("evm");

const built = routes
  .openRoute("base", source, { ...options, compile: { baseDirs: [...baseDirs] } })
  .reward(reward);
```

The `baseDirs` matter: the emitted program does `import { IERC20 } from "./artifacts/IERC20.json"`,
and a route supplies token base dirs automatically only when its own `USDC.transfer(…)` rewrite
fires — which it does not for source a builder already emitted. Without them the compile fails on
that import. Spread them: `toSauceScript`'s array is `readonly`, the option is not.

`.source(target)` gives you the source alone if you are supplying `baseDirs` yourself.

`swap` and `deposit` have no `toSauceScript`. They return the source directly, so pair each with its
own constant:

```ts
import { routes, swap, deposit } from "@eco-incorp/sauce";

routes
  .openRoute("base", swap.swapSource(spec), {
    ...options,
    compile: { baseDirs: [...swap.SWAP_BASE_DIRS] },
  })
  .reward(reward);

routes
  .openRoute("base", deposit.depositSource(spec), {
    ...options,
    compile: { baseDirs: [...deposit.DEPOSIT_BASE_DIRS] },
  })
  .reward(reward);
```

`routes.compileSauceRoute` is the lower level underneath, if you want the compiled call without an
intent — it returns `{ calls, compiled, source }` and has no `.reward()`.

**On the SVM target this route path does not work.** `toSauceScript('svm')` emits `main` with typed
account parameters — that parameter list _is_ the account manifest, so it cannot be dropped — and a
route runs an acorn-based accessor rewrite that rejects annotations. `compile: { accessors: false }` gets past the parse, but a route then still requires
`execution.buffer` naming an already-staged program buffer, so unless you have staged one, compile
the source directly instead.

## The compiler

`/compiler` re-exports the published Rust/wasm SauceScript compiler:

```ts
import { compile } from "@eco-incorp/sauce/compiler";

const { bytecode } = compile({
  target: "evm", // or 'svm'
  entry: "main.js",
  resolve: (path) => bytesFor(path), // module BYTES (Uint8Array), or undefined
});
```

`main` may take parameters. They arrive at run time as 32-byte big-endian words appended after the
program, on **both** targets, so one program serves many argument sets — compile-time substitution is
`defines` instead.

That applies to a **direct `compile`**. A route slots `compiled.bytecode[0]` in as the whole cook
ingredient and appends no argument tail, so a parameterized `main` in a route body reads past the end
of its own ingredient. Use `defines` for routes, parameters for programs you assemble yourself.

A `bytes` parameter is not padded — it occupies its fixed compile-time length, so the tail is not
uniformly 32-byte words once one is present.

Neither call returns an argument layout, so callers build the tail themselves. Mind which
`CompileResult` you have — there are two, and they are not the same shape:

|                | shape                                            | from                                  |
| -------------- | ------------------------------------------------ | ------------------------------------- |
| the compiler's | `{ bytecode: Uint8Array; manifest? }`            | a direct `compile`                    |
| the SDK's      | `{ bytecode: Uint8Array[]; warnings: string[] }` | `built.compiled`, `compileSauceRoute` |

The SDK's `bytecode` is a list of SEGMENTS, so `compiled.bytecode[0]` is the first segment, not the
first byte. On **SVM** an `Account`-typed parameter is not a payload argument at all: it becomes the
account manifest in the COMPILER's `CompileResult.manifest` — the route seam drops it
(`rs-compile.ts`), so `built.compiled.manifest` is `undefined` with no error. An SVM caller that
needs the manifest compiles through `svm/` directly.

A `main` that falls off the end has no return type of its own, and a raw `compile` rejects it
(`` `main` does not return on every path ``). Generated programs hit this whenever they fall through
— which most do, though not all: a trailing `Token.balanceOf` emits a `return`, and annotating that
one `: void` would break it. Either annotate it yourself (`function main(): void { … }`) or go through
`routes.compileSauceRoute`, which annotates it for you. Note that one takes
`(destination, sauce, execution, options)`: the execution seam is required, and an SVM destination
needs an already-staged buffer, so it is the route path rather than a bare compile helper.

## Registries

129 protocols and 39 canonical chains ship with the package — 38 EVM plus Solana:

```ts
import { listProtocols, getProtocol, requireChain } from "@eco-incorp/sauce";

listProtocols().length; // 129
getProtocol("uniswap-v3"); // metadata: category, per-chain deployments, audit status
// (ABIs live on the subpath: '@eco-incorp/sauce/protocols/uniswap-v3')
```

`requireChain` and `getChain` read different registries: `CANONICAL_CHAINS` has all 39, while the
`chains` export has 33 of the 38 EVM ones — `unichain`, `sonic`, `ronin`, `plasma` and `ink` are
canonical but absent from it, so `getChain(130)` is `undefined` where `requireChain('unichain')`
resolves.

```ts
requireChain("base").id; // 8453 — reads CANONICAL_CHAINS (all 39)
```

## Subpaths

| Subpath                                                    | What's there                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `.`                                                        | routes DSL, `token`/`swap`/`deposit` builders, chain + protocol registries |
| `/compiler`                                                | the SauceScript compiler                                                   |
| `/actions`                                                 | routing-intent lowering (`actionsToSauce`), AMM/bridge action primitives   |
| `/protocols/*`                                             | one protocol's ABIs and metadata, e.g. `/protocols/uniswap-v3`             |
| `/chains`, `/deployments`                                  | canonical chain list; deployed contract addresses                          |
| `/recipes`                                                 | shipped programs (settle, CCTP split-transfer) and their sources           |
| `/svm`, `/svm/engine`, `/svm/verify`                       | SVM client, account resolution, engine harness, settle verification        |
| `/recipes/settle.sauce.ts`, `/svm/recipes/settle.sauce.ts` | the settle program sources themselves, for partners reproducing bytes      |
| `/evm/engine`                                              | EVM engine helpers                                                         |
| `/verify`                                                  | decodes **legacy v1-grammar** settle programs. `viem`-only, browser-safe   |
| `/skills`                                                  | AI skill files per protocol                                                |

`/verify` is for programs already on chain: it reads the v1 prologue that the retired TypeScript
compiler emitted. Programs built by this SDK today are not v1-grammar, so it will refuse them.

Verifying a program you built means recompiling it from the same source and comparing bytes.
`/svm/verify` does exactly that for SVM settle programs; there is no EVM counterpart in the package
today, so an EVM caller applies the technique themselves.

## Development

```sh
pnpm install
pnpm build       # sdk + actions
pnpm typecheck
pnpm test
```

## Publishing

Tag-driven, via [`.github/workflows/publish.yml`](.github/workflows/publish.yml):

```sh
git tag v1.2.3 && git push origin v1.2.3
```

The workflow stamps the version from the tag inside the runner (`npm version --no-git-tag-version`)
and publishes to **npmjs.com only**. The `version` in `package.json` is therefore not the source of
truth and will read older than the latest release — that is expected.
