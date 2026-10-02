<!-- Generated from the SDK's registries. Do not edit. -->

# Unichain

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Unichain a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Unichain, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Unichain%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Unichain+%28130%29&chain=Unichain&chain-id=130) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `unichain` |
| Chain id | 130 |
| Kind | EVM |
| Name in a program | `Unichain` |
| In TypeScript | `import { Unichain } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | not recorded |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000769A73b70e16f361a442292500b3BCf4A85` |
| Intent Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Shared intent Pot | `0xDd330394620fBFF4D0AdcfA33B0D7b3622Db15B0`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |
| CCTP domain | 10 |

## In a program

Compiled with `--chain unichain`, a program names Unichain's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `Cctp.TokenMessenger` is Unichain's tokenMessenger: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.
  require(Cctp.TokenMessenger != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Unichain.Cctp.TokenMessenger == Cctp.TokenMessenger);
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
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x1f98400000000000000000000000000000000004` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0x86e8631a016f9068c3f085faf484ee3f5fdee8f2` | `UniswapV4.StateView` |
