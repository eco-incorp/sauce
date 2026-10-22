<!-- Generated from the SDK's registries. Do not edit. -->

# Manta Pacific

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Manta Pacific: its tokens, and every protocol deployed there with
> the name a program writes for each contract. Manta Pacific is a preview chain: programs compile
> and simulate here, and the `sauce` command sends nothing.

**Preview chain.** Sauce supports transactions on Ethereum, Base and Solana only. On Manta Pacific a program
compiles and simulates (`sauce compile`, `sauce simulate`), but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `manta` |
| Chain id | 169 |
| Kind | EVM |
| Name in a program | `Manta` |
| In TypeScript | `import { Manta } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.

## Requesting support

To request Manta Pacific, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Manta+Pacific%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Manta+Pacific+%28169%29&chain=Manta+Pacific&chain-id=169) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
