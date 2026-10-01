<!-- Generated from the SDK's registries. Do not edit. -->

# Fantom

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `fantom`; also `ftm`, `opera`, `fantom-opera` |
| Chain id | 250 |
| Kind | EVM |
| Name in a program | `Fantom` |
| Native coin | FTM (FTM), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain fantom`, a program names Fantom's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=fantom
function main() {
  // `AaveV3.Pool` is Fantom's pool: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`.
  require(AaveV3.Pool != 0n);
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
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `CurveAddressProviderABI.at(0x0000000022D53366457F9d5E68Ec105046FC4383n)` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [OpenOcean](../../sauce-protocols/references/registry/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [SpookySwap](../../sauce-protocols/references/registry/spookyswap.md) | v2Router | `0xF491e7B69E4244ad4002BC14e878a34207E38c29` | `SpookySwapRouterABI.at(0xF491e7B69E4244ad4002BC14e878a34207E38c29n)` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
