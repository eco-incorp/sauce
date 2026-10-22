<!-- Generated from the SDK's registries. Do not edit. -->

# Moonbeam

**Preview chain.** Sauce supports transactions on Ethereum, Base and Solana only. On Moonbeam a program
compiles and simulates (`sauce compile`, `sauce simulate`), but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one.

To request Moonbeam, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Moonbeam%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Moonbeam+%281284%29&chain=Moonbeam&chain-id=1284) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `moonbeam` |
| Chain id | 1284 |
| Kind | EVM |
| Name in a program | `Moonbeam` |
| Native coin | GLMR (GLMR), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.
