<!-- Generated from the SDK's registries. Do not edit. -->

# Ethereum Sepolia

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Ethereum Sepolia: its tokens, and every protocol deployed there
> with the name a program writes for each contract. The `sauce` command builds and sends
> transactions on Ethereum Sepolia.

**Supported testnet.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet. On Ethereum Sepolia a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them. Ethereum Sepolia is a test network: its coin and tokens have no value.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `sepolia`; also `ethereum-sepolia`, `eth-sepolia` |
| Chain id | 11155111 |
| Kind | EVM |
| Network | testnet: its coin and tokens have no value |
| Name in a program | `Sepolia` |
| In TypeScript | `import { Sepolia } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain sepolia`, a program names Ethereum Sepolia's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
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

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
