<!-- Generated from the SDK's registries. Do not edit. -->

# Core

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Core: its tokens, and every protocol deployed there with the name
> a program writes for each contract. Core is a preview chain: programs compile and simulate here,
> and the `sauce` command sends nothing.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Core a program
compiles and simulates (`sauce compile`, `sauce simulate`, the dry runs), but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `core`; also `coredao`, `core-dao` |
| Chain id | 1116 |
| Kind | EVM |
| Name in a program | `Core` |
| In TypeScript | `import { Core } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | CORE (CORE), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.

## Requesting support

To request Core, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Core%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Core+%281116%29&chain=Core&chain-id=1116) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
