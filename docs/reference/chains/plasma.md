<!-- Generated from the SDK's registries. Do not edit. -->

# Plasma

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Plasma a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Plasma, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Plasma%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Plasma+%289745%29&chain=Plasma&chain-id=9745) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `plasma` |
| Chain id | 9745 |
| Kind | EVM |
| Name in a program | `Plasma` |
| In TypeScript | `import { Plasma } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | not recorded |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| Intents (eco-routes) | takes intents; Portal `0xEC000769A73b70e16f361a442292500b3BCf4A85` |
| Intent Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Shared intent Pot | the Executor's Pot under salt zero, the same on every chain: [Deployments](../deployments.md#the-shared-intent-pot); the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |

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
  // `Polymer.CrossL2ProverV2` is Plasma's crossL2ProverV2: `0x95ccEAE71605c5d97A0AC0EA13013b058729d075`.
  require(Polymer.CrossL2ProverV2 != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Plasma.Polymer.CrossL2ProverV2 == Polymer.CrossL2ProverV2);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` | 6 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Polymer](../protocols/polymer.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
