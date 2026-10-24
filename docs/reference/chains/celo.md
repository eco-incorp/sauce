<!-- Generated from the SDK's registries. Do not edit. -->

# Celo

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Celo: its tokens, and every protocol deployed there with the name
> a program writes for each contract. Celo is a preview chain: programs compile here and the reads
> work, but the released engine is not deployed here, so nothing is simulated or sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Celo a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
but `sauce simulate` stops there, the released engine not being deployed on it, and the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no simulation, and no transaction is built or sent |
| Slug (`--chain`) | `celo` |
| Chain id | 42220 |
| Kind | EVM |
| Name in a program | `Celo` |
| In TypeScript | `import { Celo } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | CELO (CELO), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain celo`, a program names Celo's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `UniswapV3.Factory` is Celo's factory: `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc`.
  require(UniswapV3.Factory != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Celo.UniswapV3.Factory == UniswapV3.Factory);
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
| [Uniswap V3](../protocols/uniswap-v3.md) | factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` | `UniswapV3.Factory` |
| [Uniswap V3](../protocols/uniswap-v3.md) | nonfungiblePositionManager | `0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../protocols/uniswap-v3.md) | quoterV2 | `0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x288dc841A52FCA2707c6947B3A777c5E56cd87BC` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0xbc21f8720BABf4b20d195eE5C6e99c52b76F2bfb` | `UniswapV4.StateView` |

## Requesting support

To request Celo, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Celo%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Celo+%2842220%29&chain=Celo&chain-id=42220) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
