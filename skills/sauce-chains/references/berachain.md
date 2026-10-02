<!-- Generated from the SDK's registries. Do not edit. -->

# Berachain

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Berachain a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Berachain, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Berachain%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Berachain+%2880094%29&chain=Berachain&chain-id=80094) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `berachain`; also `bera` |
| Chain id | 80094 |
| Kind | EVM |
| Name in a program | `Berachain` |
| Native coin | BERA (BERA), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain berachain`, a program names Berachain's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=berachain
function main() {
  // `USDT0` is Berachain's USDT0: `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`.
  const held = USDT0.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDT0).balanceOf(ctx.self()) == held);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 |

## Protocols

The registry records no protocol deployment on this chain.
