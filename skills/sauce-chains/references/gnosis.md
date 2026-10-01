<!-- Generated from the SDK's registries. Do not edit. -->

# Gnosis

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `gnosis`; also `xdai`, `gnosis-chain` |
| Chain id | 100 |
| Kind | EVM |
| Name in a program | `Gnosis` |
| Native coin | xDAI (xDAI), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain gnosis`, a program names Gnosis's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=gnosis
function main() {
  // `AaveV3.Pool` is Gnosis's pool: `0xb50201558B00496A145fE76f7424749556E326D8`.
  require(AaveV3.Pool != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Gnosis.AaveV3.Pool == AaveV3.Pool);
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
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0xb50201558B00496A145fE76f7424749556E326D8` | `AaveV3.Pool` |
| [Balancer V2](../../sauce-protocols/references/registry/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2VaultABI.at(0xBA12222222228d8Ba445958a75a0704d566BF2C8n)` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `CurveAddressProviderABI.at(0x0000000022D53366457F9d5E68Ec105046FC4383n)` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
