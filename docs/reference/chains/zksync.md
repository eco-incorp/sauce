<!-- Generated from the SDK's registries. Do not edit. -->

# zkSync Era

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on zkSync Era: its tokens, and every protocol deployed there with
> the name a program writes for each contract. zkSync Era is a preview chain: programs compile here
> and the reads work, and simulate runs wherever the release is deployed, but no transaction is
> built or sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet only. On zkSync Era a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `zksync` |
| Chain id | 324 |
| Kind | EVM |
| Name in a program | `Zksync` |
| In TypeScript | `import { Zksync } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain zksync`, a program names zkSync Era's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
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
| [Across](../protocols/across.md) | spokePool | `0xE0B015E54d54fc84a6cB9B666099c46adE9335FF` | `Across.SpokePool` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF` | `Layerzero.EndpointV2` |
| [SyncSwap](../protocols/syncswap.md) | router | `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295` | `Syncswap.Router` |
| [ZeroLend](../protocols/zerolend.md) | pool | `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8` | `Zerolend.Pool` |
| [zkSync Native Bridge](../protocols/zksync-bridge.md) | l2Bridge | `0x11f943b2c77b743AB90f4A0Ae7d5A4e7FCA3E102` | `ZksyncBridge.L2Bridge` |

## Requesting support

To request zkSync Era, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22zkSync+Era%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+zkSync+Era+%28324%29&chain=zkSync+Era&chain-id=324) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
