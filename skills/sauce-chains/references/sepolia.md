<!-- Generated from the SDK's registries. Do not edit. -->

# Ethereum Sepolia

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
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |
| CCTP domain | 0 |

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
  // `Cctp.TokenMessenger` is Ethereum Sepolia's tokenMessenger: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`.
  require(Cctp.TokenMessenger != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Sepolia.Cctp.TokenMessenger == Cctp.TokenMessenger);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
