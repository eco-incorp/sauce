# @eco-incorp/sauce-sdk

Build, compile and verify Sauce programs — cross-chain intents that execute as bytecode on the Eco
Portal. One package, TypeScript, EVM and SVM.

```sh
npm install @eco-incorp/sauce-sdk
```

The SauceScript compiler comes with it as a dependency. The only optional extra is
`@solana/web3.js`, needed just for the `/svm/engine/web3js` interop subpath.

A `sauce-dev-tools` binary ships with the package for the local fork environment and script runner.

## Quickstart

Open a route on a destination chain, and the SDK compiles the program and assembles the intent:

```ts
import { routes } from '@eco-incorp/sauce-sdk'

const built = routes.openRoute('base', 'function main() { return 1n; }', {
  source: 'ethereum',            // where the reward is posted
  pot, portal, creator, prover,
  deadline: routeDeadline,       // how long a solver has to fulfil
  rewardDeadline,                // must be >= routeDeadline, or the reward can expire
}).reward(rewardAmount)          // mid-fulfilment and no solver will take it

built.compiled.bytecode[0]   // the program
built.intent                 // the assembled Intent, ready to publish
```

`routes.openRoute(destination, …)` is what the chain globals forward to, so
`Base(sauce, options).reward(…)` is the same call.

> **Route bodies are unannotated SauceScript.** The SDK runs source rewrites over the body before
> compiling, and those parse plain JS — `function main(): Uint256 { … }` is rejected. Annotated
> SauceScript is fine when you call the compiler directly (below), just not through a route.

## Building programs without writing SauceScript

The `token`, `swap` and `deposit` namespaces emit SauceScript for you:

```ts
import { routes, token } from '@eco-incorp/sauce-sdk'

// toSauceScript returns the baseDirs the program's own imports need, alongside the source
const { source, baseDirs } = token.Token
  .transfer({ token: usdc, to: recipient, amount: 1_000_000n })
  .toSauceScript('evm')

const built = routes.openRoute('base', source, { ...options, compile: { baseDirs } }).reward(reward)
```

The `baseDirs` matter: the emitted program does `import { IERC20 } from "./artifacts/IERC20.json"`,
and a route only supplies token base dirs automatically when its own `USDC.transfer(…)` rewrite
fires — which it does not for source a builder already emitted. Without them the compile fails with
`failed to import \`IERC20\``. `.source(target)` gives you the source alone if you are supplying
`baseDirs` yourself.

## The compiler

`/compiler` re-exports the published Rust/wasm SauceScript compiler:

```ts
import { compile } from '@eco-incorp/sauce-sdk/compiler'

const { bytecode } = compile({
  target: 'evm',                                  // or 'svm'
  entry: 'main.js',
  resolve: (path) => sourceFor(path),             // your loader; return undefined if unknown
})
```

`main` may take parameters — they arrive at run time as 32-byte words appended to the program, so one
program serves many argument sets. Compile-time substitution is `defines` instead.

Use `routes.compileSauceRoute` rather than a raw `compile` for **generated** programs: a generated
`main` falls off the end and has no return type of its own, which a raw compile rejects.

## Registries

129 protocols and 39 canonical chains ship with the package — EVM plus Solana:

```ts
import { listProtocols, getProtocol, requireChain } from '@eco-incorp/sauce-sdk'

listProtocols().length          // 129
getProtocol('uniswap-v3')       // ABIs, addresses, per-chain deployments
requireChain('base').id         // 8453 — reads CANONICAL_CHAINS (39; `chains` is the 33 EVM ones)
```

## Subpaths

| Subpath | What's there |
| --- | --- |
| `.` | routes DSL, `token`/`swap`/`deposit` builders, chain + protocol registries |
| `/compiler` | the SauceScript compiler |
| `/actions` | routing-intent lowering (`actionsToSauce`), AMM/bridge action primitives |
| `/protocols/*` | one protocol's ABIs and metadata, e.g. `/protocols/uniswap-v3` |
| `/chains`, `/deployments` | canonical chain list; deployed contract addresses |
| `/recipes` | shipped programs (settle, CCTP split-transfer) and their sources |
| `/svm`, `/svm/engine`, `/svm/verify` | SVM client, account resolution, engine harness, settle verification |
| `/svm/engine/web3js` | the same engine against `@solana/web3.js` (optional peer) |
| `/recipes/settle.sauce.ts`, `/svm/recipes/settle.sauce.ts` | the settle program sources themselves, for partners reproducing bytes |
| `/evm/engine` | EVM engine helpers |
| `/verify` | decodes **legacy v1-grammar** settle programs. `viem`-only, browser-safe |
| `/skills` | AI skill files per protocol |

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
