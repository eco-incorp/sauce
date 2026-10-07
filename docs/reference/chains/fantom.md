<!-- Generated from the SDK's registries. Do not edit. -->

# Fantom

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Fantom a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Fantom, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Fantom%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Fantom+%28250%29&chain=Fantom&chain-id=250) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `fantom`; also `ftm`, `opera`, `fantom-opera` |
| Chain id | 250 |
| Kind | EVM |
| Name in a program | `Fantom` |
| In TypeScript | `import { Fantom } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | FTM (FTM), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain fantom`, a program names Fantom's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `AaveV3.Pool` is Fantom's pool: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Fantom.AaveV3.Pool == AaveV3.Pool);
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
| [Aave V3](../protocols/aave-v3.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Curve Finance](../protocols/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LI.FI](../protocols/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [OpenOcean](../protocols/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [SpookySwap](../protocols/spookyswap.md) | v2Router | `0xF491e7B69E4244ad4002BC14e878a34207E38c29` | `Spookyswap.V2Router` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
