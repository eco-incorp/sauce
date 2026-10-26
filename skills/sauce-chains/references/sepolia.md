<!-- Generated from the SDK's registries. Do not edit. -->

# Ethereum Sepolia

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet and Base Sepolia only. On Ethereum Sepolia a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one.

To request Ethereum Sepolia, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Ethereum+Sepolia%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Ethereum+Sepolia+%2811155111%29&chain=Ethereum+Sepolia&chain-id=11155111) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `sepolia`; also `ethereum-sepolia`, `eth-sepolia` |
| Chain id | 11155111 |
| Kind | EVM |
| Network | testnet: its coin and tokens have no value |
| Name in a program | `Sepolia` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |

## In a program

Compiled with `--chain sepolia`, a program names Ethereum Sepolia's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=sepolia
function main() {
  // `USDC` is Ethereum Sepolia's USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
  const held = USDC.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(pot) == held);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6 |

## Protocols

The registry records no protocol deployment on this chain.
