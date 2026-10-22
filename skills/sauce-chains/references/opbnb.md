<!-- Generated from the SDK's registries. Do not edit. -->

# opBNB

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On opBNB a program
compiles and simulates (`sauce compile`, `sauce simulate`), but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one.

To request opBNB, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22opBNB%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+opBNB+%28204%29&chain=opBNB&chain-id=204) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `opbnb` |
| Chain id | 204 |
| Kind | EVM |
| Name in a program | `Opbnb` |
| Native coin | BNB (BNB), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |

## In a program

Compiled with `--chain opbnb`, a program names opBNB's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=opbnb
function main() {
  // `PancakeswapV2.Factory` is opBNB's factory: `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E`.
  require(PancakeswapV2.Factory != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Opbnb.PancakeswapV2.Factory == PancakeswapV2.Factory);
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
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |
