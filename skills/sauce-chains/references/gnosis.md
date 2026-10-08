<!-- Generated from the SDK's registries. Do not edit. -->

# Gnosis

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Gnosis a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Gnosis, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Gnosis%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Gnosis+%28100%29&chain=Gnosis&chain-id=100) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `gnosis`; also `xdai`, `gnosis-chain` |
| Chain id | 100 |
| Kind | EVM |
| Name in a program | `Gnosis` |
| Native coin | xDAI (xDAI), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain gnosis`, a program names Gnosis's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=gnosis
function main() {
  // `AaveV3.Pool` is Gnosis's pool: `0xb50201558B00496A145fE76f7424749556E326D8`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Gnosis.AaveV3.Pool == AaveV3.Pool);
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
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0xb50201558B00496A145fE76f7424749556E326D8` | `AaveV3.Pool` |
| [Balancer V2](../../sauce-protocols/references/registry/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
