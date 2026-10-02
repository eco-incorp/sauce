<!-- Generated from the SDK's registries. Do not edit. -->

# Scroll

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Scroll a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Scroll, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Scroll%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Scroll+%28534352%29&chain=Scroll&chain-id=534352) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `scroll` |
| Chain id | 534352 |
| Kind | EVM |
| Name in a program | `Scroll` |
| In TypeScript | `import { Scroll } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain scroll`, a program names Scroll's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `AaveV3.Pool` is Scroll's pool: `0x11fCfe756c05AD438e312a7fd934381537D3cFfe`.
  require(AaveV3.Pool != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Scroll.AaveV3.Pool == AaveV3.Pool);
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
| [Aave V3](../protocols/aave-v3.md) | pool | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` | `AaveV3.Pool` |
| [Across](../protocols/across.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool` |
| [Ambient](../protocols/ambient.md) | crocSwapDex | `0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106` | `Ambient.CrocSwapDex` |
| [Compound V3](../protocols/compound-v3.md) | cUSDCv3 | `0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44` | `CompoundV3.CUSDCv3` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerBank](../protocols/layerbank.md) | core | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` | `Layerbank.Core` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Scroll Native Bridge](../protocols/scroll-bridge.md) | l2GatewayRouter | `0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79` | `ScrollBridge.L2GatewayRouter` |
| [Scroll Native Bridge](../protocols/scroll-bridge.md) | l2ScrollMessenger | `0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC` | `ScrollBridge.L2ScrollMessenger` |
