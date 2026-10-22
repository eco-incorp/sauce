<!-- Generated from the SDK's registries. Do not edit. -->

# Blast

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Blast: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Blast is a preview chain: programs compile and simulate
> here, and the `sauce` command sends nothing.

**Preview chain.** Sauce supports transactions on Ethereum, Base and Solana only. On Blast a program
compiles and simulates (`sauce compile`, `sauce simulate`), but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `blast` |
| Chain id | 81457 |
| Kind | EVM |
| Name in a program | `Blast` |
| In TypeScript | `import { Blast } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain blast`, a program names Blast's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `Across.SpokePool` is Blast's spokePool: `0x2D509190Ed0172ba588407D4c2df918F955Cc6E1`.
  require(Across.SpokePool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Blast.Across.SpokePool == Across.SpokePool);
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
| [Across](../protocols/across.md) | spokePool | `0x2D509190Ed0172ba588407D4c2df918F955Cc6E1` | `Across.SpokePool` |
| [Fenix](../protocols/fenix.md) | router | `0xbD571125856975DBfC2E9b6d1DE496D614D7BAEE` | `Fenix.Router` |
| [Thruster](../protocols/thruster.md) | v3SwapRouter | `0x337827814155ECBf24D20231fCA4444F530c0555` | `Thruster.V3SwapRouter` |
| [Uniswap V2](../protocols/uniswap-v2.md) | factory | `0x5C346464d33F90bABaf70dB6388507CC889C1070` | `UniswapV2.Factory` |
| [Uniswap V2](../protocols/uniswap-v2.md) | router | `0xBB66Eb1c5e875933D44DAe661dbD80e5D9B03035` | `UniswapV2.Router` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x1631559198a9e474033433b2958dabc135ab6446` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0x12a88ae16f46dce4e8b15368008ab3380885df30` | `UniswapV4.StateView` |

## Requesting support

To request Blast, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Blast%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Blast+%2881457%29&chain=Blast&chain-id=81457) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
