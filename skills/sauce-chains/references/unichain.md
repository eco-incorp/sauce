<!-- Generated from the SDK's registries. Do not edit. -->

# Unichain

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Unichain a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
but `sauce simulate` stops there, the released engine not being deployed on it, and the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one.

To request Unichain, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Unichain%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Unichain+%28130%29&chain=Unichain&chain-id=130) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no simulation, and no transaction is built or sent |
| Slug (`--chain`) | `unichain` |
| Chain id | 130 |
| Kind | EVM |
| Name in a program | `Unichain` |
| Native coin | not recorded |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |
| CCTP domain | 10 |

## In a program

Compiled with `--chain unichain`, a program names Unichain's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=unichain
function main() {
  // `USDT0` is Unichain's USDT0: `0x9151434b16b9763660705744891fA906F660EcC5`.
  const held = USDT0.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDT0).balanceOf(ctx.self()) == held);
  // `Cctp.TokenMessenger` is Unichain's tokenMessenger: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.
  require(Cctp.TokenMessenger != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Unichain.Cctp.TokenMessenger == Cctp.TokenMessenger);
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
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x1F98400000000000000000000000000000000004` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0x86e8631A016F9068C3f085fAF484Ee3F5fDee8f2` | `UniswapV4.StateView` |
