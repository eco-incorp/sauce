<!-- Generated from the SDK's registries. Do not edit. -->

# Celo

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Celo a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Celo, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Celo%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Celo+%2842220%29&chain=Celo&chain-id=42220) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `celo` |
| Chain id | 42220 |
| Kind | EVM |
| Name in a program | `Celo` |
| Native coin | CELO (CELO), 18 decimals |
| Sauce engine | `0xcF7A92abCC7Ede43277AcCBAfda910b8829bF9AD` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain celo`, a program names Celo's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=celo
function main() {
  // `UniswapV3.Factory` is Celo's factory: `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc`.
  require(UniswapV3.Factory != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Celo.UniswapV3.Factory == UniswapV3.Factory);
}
```

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x288dc841A52FCA2707c6947B3A777c5E56cd87BC` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0xbc21f8720babf4b20d195ee5c6e99c52b76f2bfb` | `UniswapV4.StateView` |
