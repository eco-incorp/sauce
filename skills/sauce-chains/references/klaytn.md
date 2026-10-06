<!-- Generated from the SDK's registries. Do not edit. -->

# Klaytn

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Klaytn a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Klaytn, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Klaytn%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Klaytn+%288217%29&chain=Klaytn&chain-id=8217) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `klaytn`; also `kaia` |
| Chain id | 8217 |
| Kind | EVM |
| Name in a program | `Klaytn` |
| Native coin | KLAY (KLAY), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |
| Intents (eco-routes) | none recorded |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.
