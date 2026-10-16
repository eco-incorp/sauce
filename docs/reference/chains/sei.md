<!-- Generated from the SDK's registries. Do not edit. -->

# Sei

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Sei: its tokens, and every protocol deployed there with the name
> a program writes for each contract. Sei is a preview chain: programs compile and simulate here,
> and the `sauce` command sends nothing.

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Sei a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Sei, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Sei%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Sei+%281329%29&chain=Sei&chain-id=1329) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `sei`; also `sei-evm` |
| Chain id | 1329 |
| Kind | EVM |
| Name in a program | `Sei` |
| In TypeScript | `import { Sei } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | SEI (SEI), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain sei`, a program names Sei's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDT0` is Sei's USDT0: `0x9151434b16b9763660705744891fA906F660EcC5`.
  const held = USDT0.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDT0).balanceOf(ctx.self()) == held);
  // `CircleGateway.GatewayMinter` is Sei's gatewayMinter: `0x2222222d7164433c4C09B0b0D809a9b52C04C205`.
  require(CircleGateway.GatewayMinter != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Sei.CircleGateway.GatewayMinter == CircleGateway.GatewayMinter);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDT0` | `0x9151434b16b9763660705744891fA906F660EcC5` | 6 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
