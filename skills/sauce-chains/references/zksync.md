<!-- Generated from the SDK's registries. Do not edit. -->

# zkSync Era

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `zksync` |
| Chain id | 324 |
| Kind | EVM |
| Name in a program | `Zksync` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Across](../../sauce-protocols/references/registry/across.md) | spokePool | `0xE0B015E54d54fc84a6cB9B666099c46adE9335FF` | `AcrossSpokePoolABI.at(0xE0B015E54d54fc84a6cB9B666099c46adE9335FFn)` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923` | `KyberSwapMetaAggregationRouterABI.at(0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923n)` |
| [LayerZero](../../sauce-protocols/references/registry/layerzero.md) | endpointV2 | `0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF` | `LayerZeroEndpointV2ABI.at(0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBFn)` |
| [SyncSwap](../../sauce-protocols/references/registry/syncswap.md) | router | `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295` | `SyncSwapRouterABI.at(0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295n)` |
| [ZeroLend](../../sauce-protocols/references/registry/zerolend.md) | pool | `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8` | `ZeroLendPoolABI.at(0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8n)` |
| [zkSync Native Bridge](../../sauce-protocols/references/registry/zksync-bridge.md) | l2Bridge | `0x11f943b2c77b743AB90f4A0Ae7d5A4e7FCA3E102` | no registry ABI |
