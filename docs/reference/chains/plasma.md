<!-- Generated from the SDK's registries. Do not edit. -->

# Plasma

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Plasma: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Plasma is a preview chain: programs compile here and the
> reads work, and simulate runs wherever the release is deployed, but no transaction is built or
> sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Plasma a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `plasma` |
| Chain id | 9745 |
| Kind | EVM |
| Name in a program | `Plasma` |
| In TypeScript | `import { Plasma } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | not recorded |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain plasma`, a program names Plasma's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDT0` is Plasma's USDT0: `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`.
  const held = USDT0.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDT0).balanceOf(ctx.self()) == held);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` | 6 |

## Protocols

The registry records no protocol deployment on this chain.

## Requesting support

To request Plasma, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Plasma%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Plasma+%289745%29&chain=Plasma&chain-id=9745) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
