<!-- Generated from the SDK's registries. Do not edit. -->

# Ink

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet only. On Ink a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one.

To request Ink, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Ink%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Ink+%2857073%29&chain=Ink&chain-id=57073) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `ink` |
| Chain id | 57073 |
| Kind | EVM |
| Name in a program | `Ink` |
| Native coin | not recorded |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |

## In a program

Compiled with `--chain ink`, a program names Ink's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=ink
function main() {
  // `USDT0` is Ink's USDT0: `0x0200C29006150606B650577BBE7B6248F58470c1`.
  const held = USDT0.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDT0).balanceOf(pot) == held);
  // `UniswapV4.PoolManager` is Ink's poolManager: `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32`.
  require(UniswapV4.PoolManager != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Ink.UniswapV4.PoolManager == UniswapV4.PoolManager);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x0200C29006150606B650577BBE7B6248F58470c1` | 6 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990` | `UniswapV4.StateView` |
