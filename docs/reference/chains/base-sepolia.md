<!-- Generated from the SDK's registries. Do not edit. -->

# Base Sepolia

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Base Sepolia: its tokens, and every protocol deployed there with
> the name a program writes for each contract. The `sauce` command builds and sends transactions on
> Base Sepolia.

**Supported testnet.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet. On Base Sepolia a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them. Base Sepolia is a test network: its coin and tokens have no value.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `base-sepolia` |
| Chain id | 84532 |
| Kind | EVM |
| Network | testnet: its coin and tokens have no value |
| Name in a program | `BaseSepolia` |
| In TypeScript | `import { BaseSepolia } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| CCTP domain | 6 |

## In a program

Compiled with `--chain base-sepolia`, a program names Base Sepolia's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDC` is Base Sepolia's USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
  const held = USDC.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(pot) == held);
  // `Cctp.TokenMessenger` is Base Sepolia's tokenMessenger: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`.
  require(Cctp.TokenMessenger != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(BaseSepolia.Cctp.TokenMessenger == Cctp.TokenMessenger);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
