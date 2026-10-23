<!-- Generated from the SDK's registries. Do not edit. -->

# Ink

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Ink: its tokens, and every protocol deployed there with the name
> a program writes for each contract. Ink is a preview chain: programs compile here and the reads
> work, but the released engine is not deployed here, so nothing is simulated or sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Ink a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
but `sauce simulate` stops there, the released engine not being deployed on it, and the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no simulation, and no transaction is built or sent |
| Slug (`--chain`) | `ink` |
| Chain id | 57073 |
| Kind | EVM |
| Name in a program | `Ink` |
| In TypeScript | `import { Ink } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | not recorded |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain ink`, a program names Ink's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDT0` is Ink's USDT0: `0x0200C29006150606B650577BBE7B6248F58470c1`.
  const held = USDT0.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDT0).balanceOf(ctx.self()) == held);
  // `UniswapV4.PoolManager` is Ink's poolManager: `0x360e68faccca8ca495c1b759fd9eee466db9fb32`.
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
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0x76fd297e2d437cd7f76d50f01afe6160f86e9990` | `UniswapV4.StateView` |

## Requesting support

To request Ink, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Ink%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Ink+%2857073%29&chain=Ink&chain-id=57073) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
