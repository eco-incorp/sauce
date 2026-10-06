<!-- Generated from the SDK's registries. Do not edit. -->

# zkSync Era

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On zkSync Era a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request zkSync Era, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22zkSync+Era%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+zkSync+Era+%28324%29&chain=zkSync+Era&chain-id=324) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `zksync` |
| Chain id | 324 |
| Kind | EVM |
| Name in a program | `Zksync` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0xcF7A92abCC7Ede43277AcCBAfda910b8829bF9AD` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain zksync`, a program names zkSync Era's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=zksync
function main() {
  // `Across.SpokePool` is zkSync Era's spokePool: `0xE0B015E54d54fc84a6cB9B666099c46adE9335FF`.
  require(Across.SpokePool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Zksync.Across.SpokePool == Across.SpokePool);
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
| [Across](../../sauce-protocols/references/registry/across.md) | spokePool | `0xE0B015E54d54fc84a6cB9B666099c46adE9335FF` | `Across.SpokePool` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../../sauce-protocols/references/registry/layerzero.md) | endpointV2 | `0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF` | `Layerzero.EndpointV2` |
| [SyncSwap](../../sauce-protocols/references/registry/syncswap.md) | router | `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295` | `Syncswap.Router` |
| [ZeroLend](../../sauce-protocols/references/registry/zerolend.md) | pool | `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8` | `Zerolend.Pool` |
| [zkSync Native Bridge](../../sauce-protocols/references/registry/zksync-bridge.md) | l2Bridge | `0x11f943b2c77b743AB90f4A0Ae7d5A4e7FCA3E102` | `ZksyncBridge.L2Bridge` |
