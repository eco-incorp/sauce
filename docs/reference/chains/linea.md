<!-- Generated from the SDK's registries. Do not edit. -->

# Linea

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Linea: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Linea is a preview chain: programs compile here and the
> reads work, and simulate runs wherever the release is deployed, but no transaction is built or
> sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet only. On Linea a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `linea` |
| Chain id | 59144 |
| Kind | EVM |
| Name in a program | `Linea` |
| In TypeScript | `import { Linea } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| CCTP domain | 11 |

## In a program

Compiled with `--chain linea`, a program names Linea's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `Across.SpokePool` is Linea's spokePool: `0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75`.
  require(Across.SpokePool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Linea.Across.SpokePool == Across.SpokePool);
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
| [Across](../protocols/across.md) | spokePool | `0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75` | `Across.SpokePool` |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Linea Native Bridge](../protocols/linea-bridge.md) | l2MessageService | `0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec` | `LineaBridge.L2MessageService` |
| [Lynex](../protocols/lynex.md) | router | `0x610D2f07b7EdC67565160F587F37636194C34E74` | `Lynex.Router` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | smartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | `PancakeswapV3.SmartRouter` |

## Requesting support

To request Linea, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Linea%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Linea+%2859144%29&chain=Linea&chain-id=59144) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
