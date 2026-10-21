<!-- Generated from the SDK's registries. Do not edit. -->

# Metis

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Metis: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Metis is a preview chain: programs compile and simulate
> here, and the `sauce` command sends nothing.

**Preview chain.** Sauce supports transactions on Ethereum, Base and Solana only. On Metis a program
compiles and simulates (`sauce compile`, `sauce simulate`, the dry runs), but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run`,
`sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `metis`; also `andromeda`, `metis-andromeda` |
| Chain id | 1088 |
| Kind | EVM |
| Name in a program | `Metis` |
| In TypeScript | `import { Metis } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | METIS (METIS), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain metis`, a program names Metis's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `AaveV3.Pool` is Metis's pool: `0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Metis.AaveV3.Pool == AaveV3.Pool);
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
| [Aave V3](../protocols/aave-v3.md) | pool | `0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57` | `AaveV3.Pool` |

## Requesting support

To request Metis, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Metis%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Metis+%281088%29&chain=Metis&chain-id=1088) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
