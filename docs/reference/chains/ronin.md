<!-- Generated from the SDK's registries. Do not edit. -->

# Ronin

> Everything a program can name on Ronin: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Ronin is a preview chain: programs compile and simulate
> here, and the `sauce` command sends nothing.

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Ronin a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Ronin, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Ronin%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Ronin+%282020%29&chain=Ronin&chain-id=2020) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `ronin` |
| Chain id | 2020 |
| Kind | EVM |
| Name in a program | `Ronin` |
| In TypeScript | `import { Ronin } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | not recorded |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| Intents (eco-routes) | takes intents; Portal `0xEC000769A73b70e16f361a442292500b3BCf4A85` |
| Intent Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Shared intent Pot | the Executor's Pot under salt zero, the same on every chain: [Deployments](../deployments.md#the-shared-intent-pot); the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.
