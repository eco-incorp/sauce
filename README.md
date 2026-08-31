# sauce-sdk

Tooling for the Sauce protocol, published as a single npm package: `@eco-incorp/sauce-sdk`.

Includes:

- A JS-like recipe **compiler** that emits Sauce bytecode.
- A TypeScript **SDK** for building against on-chain protocols (Uniswap, Curve, Balancer, …).
- High-level **action primitives** (AMM swaps, multi-hop, split routing).
- A local **dev environment** (hardhat fork, script runner, examples).

## Install

```sh
pnpm add @eco-incorp/sauce-sdk
# or
npm install @eco-incorp/sauce-sdk
```

## Import paths

Everything ships under the single `@eco-incorp/sauce-sdk` package with subpath exports:

```ts
import { compile } from '@eco-incorp/sauce-sdk/compiler'
import { protocolInfo } from '@eco-incorp/sauce-sdk/protocols/uniswap-v3'
import { Saucer } from '@eco-incorp/sauce-sdk/actions'
// the bare specifier is the SDK entry
import { /* ... */ } from '@eco-incorp/sauce-sdk'
```

## Repo layout

Sources are organised as a pnpm workspace for development; everything ships under the single `@eco-incorp/sauce-sdk` name at publish time.

| Path | What's in it | Subpath |
| --- | --- | --- |
| [`sdk/`](sdk/) | Protocols, chains, skills | `/`, `/protocols/*`, `/chains`, `/skills` |
| [`actions/`](actions/) | High-level action primitives | `/actions` |
| [`dev-tools/`](dev-tools/) | Local fork environment, script runner, examples | bin: `sauce-dev-tools` |

## Development

```sh
pnpm install
pnpm build       # sdk + actions
pnpm typecheck   # typecheck all areas
pnpm test        # run all tests
```

## Publishing

Tag-driven via [`.github/workflows/publish.yml`](.github/workflows/publish.yml):

```sh
git tag v1.2.3 && git push origin v1.2.3
```

The workflow stamps the root package with the tag's version and publishes `@eco-incorp/sauce-sdk` to both npmjs.com and GitHub Packages.
