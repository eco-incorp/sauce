<!-- Generated from the SDK's registries. Do not edit. -->

# Fuse

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Fuse a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Fuse, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Fuse%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Fuse+%28122%29&chain=Fuse&chain-id=122) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `fuse` |
| Chain id | 122 |
| Kind | EVM |
| Name in a program | `Fuse` |
| In TypeScript | `import { Fuse } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | FUSE (FUSE), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| Intents (eco-routes) | none recorded |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.
