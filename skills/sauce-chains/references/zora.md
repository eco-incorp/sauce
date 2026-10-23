<!-- Generated from the SDK's registries. Do not edit. -->

# Zora

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Zora a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
but `sauce simulate` stops there, the released engine not being deployed on it, and the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one.

To request Zora, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Zora%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Zora+%287777777%29&chain=Zora&chain-id=7777777) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no simulation, and no transaction is built or sent |
| Slug (`--chain`) | `zora` |
| Chain id | 7777777 |
| Kind | EVM |
| Name in a program | `Zora` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |

## In a program

Compiled with `--chain zora`, a program names Zora's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=zora
function main() {
  // `UniswapV2.Factory` is Zora's factory: `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C`.
  require(UniswapV2.Factory != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Zora.UniswapV2.Factory == UniswapV2.Factory);
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
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | factory | `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C` | `UniswapV2.Factory` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | router | `0xa00F34A632630EFd15223B1968358bA4845bEEC7` | `UniswapV2.Router` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x0575338e4c17006ae181b47900a84404247ca30f` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0x385785af07d63b50d0a0ea57c4ff89d06adf7328` | `UniswapV4.StateView` |
