<!-- Generated from the SDK's registries. Do not edit. -->

# Scroll

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `scroll` |
| Chain id | 534352 |
| Kind | EVM |
| Name in a program | `Scroll` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain scroll`, a program names Scroll's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=scroll
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
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` | `AaveV3.Pool` |
| [Across](../../sauce-protocols/references/registry/across.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `AcrossSpokePoolABI.at(0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96n)` |
| [Ambient](../../sauce-protocols/references/registry/ambient.md) | crocSwapDex | `0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106` | `CrocSwapDexABI.at(0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106n)` |
| [Compound V3](../../sauce-protocols/references/registry/compound-v3.md) | cUSDCv3 | `0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44` | `CompoundV3.CometUSDC` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [LayerBank](../../sauce-protocols/references/registry/layerbank.md) | core | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` | `LayerBankCoreABI.at(0xEC53c830f4444a8A56455c6836b5D2aA794289Aan)` |
| [LayerZero](../../sauce-protocols/references/registry/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Scroll Native Bridge](../../sauce-protocols/references/registry/scroll-bridge.md) | l2GatewayRouter | `0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79` | no registry ABI |
| [Scroll Native Bridge](../../sauce-protocols/references/registry/scroll-bridge.md) | l2ScrollMessenger | `0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC` | no registry ABI |
