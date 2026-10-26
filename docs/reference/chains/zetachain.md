<!-- Generated from the SDK's registries. Do not edit. -->

# ZetaChain

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on ZetaChain: its tokens, and every protocol deployed there with the
> name a program writes for each contract. ZetaChain is a preview chain: programs compile here and
> the reads work, and simulate runs wherever the release is deployed, but no transaction is built or
> sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet and Base Sepolia only. On ZetaChain a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `zetachain`; also `zeta` |
| Chain id | 7000 |
| Kind | EVM |
| Name in a program | `Zetachain` |
| In TypeScript | `import { Zetachain } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ZETA (ZETA), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.

## Requesting support

To request ZetaChain, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22ZetaChain%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+ZetaChain+%287000%29&chain=ZetaChain&chain-id=7000) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
