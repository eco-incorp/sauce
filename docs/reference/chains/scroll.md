<!-- Generated from the SDK's registries. Do not edit. -->

# Scroll

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Scroll: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Scroll is a preview chain: programs compile here and the
> reads work, and simulate runs wherever the release is deployed, but no transaction is built or
> sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet only. On Scroll a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `scroll` |
| Chain id | 534352 |
| Kind | EVM |
| Name in a program | `Scroll` |
| In TypeScript | `import { Scroll } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain scroll`, a program names Scroll's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `AaveV3.Oracle` is Scroll's oracle: `0x04421D8C506E2fA2371a08EfAaBf791F624054F3`.
  require(AaveV3.Oracle != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Scroll.AaveV3.Oracle == AaveV3.Oracle);
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
| [Aave V3](../protocols/aave-v3.md) | oracle | `0x04421D8C506E2fA2371a08EfAaBf791F624054F3` | `AaveV3.Oracle` |
| [Aave V3](../protocols/aave-v3.md) | pool | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` | `AaveV3.Pool`; not on this deployment: `dropReserve`, `resetIsolationModeTotalDebt` |
| [Aave V3](../protocols/aave-v3.md) | poolAddressesProvider | `0x69850D0B276776781C063771b161bd8894BCdD04` | `AaveV3.PoolAddressesProvider` |
| [Across](../protocols/across.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool`; not on this deployment: `__OvmSpokePool_init`, `adapterExecuteAcrossV5`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `cctpTokenMessenger`, `cctpV2`, `DEPRECATED_zkErc20Bridge`, `executeAcrossV5`, `fxChild`, `gateway`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `recipientCircleDomainId`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `usdcToken`, `V5_MAGIC_PREFIX`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [Ambient](../protocols/ambient.md) | crocSwapDex | `0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106` | `Ambient.CrocSwapDex` |
| [Compound V3](../protocols/compound-v3.md) | cUSDCv3 | `0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44` | `CompoundV3.CUSDCv3` |
| [Compound V3](../protocols/compound-v3.md) | cometRewards | `0x70167D30964cbFDc315ECAe02441Af747bE0c5Ee` | `CompoundV3.CometRewards` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerBank](../protocols/layerbank.md) | core | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` | `Layerbank.Core` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Scroll Native Bridge](../protocols/scroll-bridge.md) | l2GatewayRouter | `0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79` | `ScrollBridge.L2GatewayRouter` |
| [Scroll Native Bridge](../protocols/scroll-bridge.md) | l2ScrollMessenger | `0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC` | `ScrollBridge.L2ScrollMessenger` |

## Requesting support

To request Scroll, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Scroll%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Scroll+%28534352%29&chain=Scroll&chain-id=534352) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
