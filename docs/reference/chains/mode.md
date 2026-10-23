<!-- Generated from the SDK's registries. Do not edit. -->

# Mode

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Mode: its tokens, and every protocol deployed there with the name
> a program writes for each contract. Mode is a preview chain: programs compile and simulate here,
> and the `sauce` command sends nothing.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Mode a program
compiles and simulates (`sauce compile`, `sauce simulate`), but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `mode` |
| Chain id | 34443 |
| Kind | EVM |
| Name in a program | `Mode` |
| In TypeScript | `import { Mode } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain mode`, a program names Mode's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `Across.SpokePool` is Mode's spokePool: `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96`.
  require(Across.SpokePool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Mode.Across.SpokePool == Across.SpokePool);
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
| [Across](../protocols/across.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool` |
| [Kim](../protocols/kim.md) | v2Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` | `Kim.V2Router` |

## Requesting support

To request Mode, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Mode%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Mode+%2834443%29&chain=Mode&chain-id=34443) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
