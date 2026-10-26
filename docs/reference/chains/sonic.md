<!-- Generated from the SDK's registries. Do not edit. -->

# Sonic

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Sonic: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Sonic is a preview chain: programs compile here and the
> reads work, and simulate runs wherever the release is deployed, but no transaction is built or
> sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Sonic a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `sonic` |
| Chain id | 146 |
| Kind | EVM |
| Name in a program | `Sonic` |
| In TypeScript | `import { Sonic } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | not recorded |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| CCTP domain | 13 |

## In a program

Compiled with `--chain sonic`, a program names Sonic's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `Cctp.TokenMessenger` is Sonic's tokenMessenger: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.
  require(Cctp.TokenMessenger != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Sonic.Cctp.TokenMessenger == Cctp.TokenMessenger);
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
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |

## Requesting support

To request Sonic, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Sonic%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Sonic+%28146%29&chain=Sonic&chain-id=146) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
