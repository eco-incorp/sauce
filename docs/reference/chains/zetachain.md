<!-- Generated from the SDK's registries. Do not edit. -->

# ZetaChain

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On ZetaChain a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request ZetaChain, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22ZetaChain%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+ZetaChain+%287000%29&chain=ZetaChain&chain-id=7000) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `zetachain`; also `zeta` |
| Chain id | 7000 |
| Kind | EVM |
| Name in a program | `Zetachain` |
| In TypeScript | `import { Zetachain } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ZETA (ZETA), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.
