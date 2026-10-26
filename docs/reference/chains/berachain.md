<!-- Generated from the SDK's registries. Do not edit. -->

# Berachain

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Berachain: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Berachain is a preview chain: programs compile here and
> the reads work, and simulate runs wherever the release is deployed, but no transaction is built or
> sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Berachain a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `berachain`; also `bera` |
| Chain id | 80094 |
| Kind | EVM |
| Name in a program | `Berachain` |
| In TypeScript | `import { Berachain } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | BERA (BERA), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain berachain`, a program names Berachain's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDT0` is Berachain's USDT0: `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`.
  const held = USDT0.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDT0).balanceOf(pot) == held);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 |

## Protocols

The registry records no protocol deployment on this chain.

## Requesting support

To request Berachain, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Berachain%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Berachain+%2880094%29&chain=Berachain&chain-id=80094) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
