<!-- Generated from the SDK's registries. Do not edit. -->

# Mantle

> Everything a program can name on Mantle: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Mantle is a preview chain: programs compile and simulate
> here, and the `sauce` command sends nothing.

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Mantle a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Mantle, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Mantle%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Mantle+%285000%29&chain=Mantle&chain-id=5000) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `mantle` |
| Chain id | 5000 |
| Kind | EVM |
| Name in a program | `Mantle` |
| In TypeScript | `import { Mantle } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | MNT (MNT), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain mantle`, a program names Mantle's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDT0` is Mantle's USDT0: `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`.
  const held = USDT0.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDT0).balanceOf(ctx.self()) == held);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 |

## Protocols

The registry records no protocol deployment on this chain.
