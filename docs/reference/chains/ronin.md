<!-- Generated from the SDK's registries. Do not edit. -->

# Ronin

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
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000769A73b70e16f361a442292500b3BCf4A85` |
| Intent Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Shared intent Pot | `0xDd330394620fBFF4D0AdcfA33B0D7b3622Db15B0`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

The registry records no protocol deployment on this chain.
