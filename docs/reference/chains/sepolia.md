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
| CCTP domain | 0 |

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
  // `AaveV3.Pool` is Ethereum Sepolia's pool: `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Sepolia.AaveV3.Pool == AaveV3.Pool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6 |
| `WETH` | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | 18 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V3](../protocols/aave-v3.md) | pool | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` | `AaveV3.Pool` |
| [Aave V3](../protocols/aave-v3.md) | poolAddressesProvider | `0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A` | `AaveV3.PoolAddressesProvider` |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
| [Uniswap V2](../protocols/uniswap-v2.md) | factory | `0xF62c03E08ada871A0bEb309762E260a7a6a880E6` | `UniswapV2.Factory` |
| [Uniswap V2](../protocols/uniswap-v2.md) | router | `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3` | `UniswapV2.Router` |
| [Uniswap V3](../protocols/uniswap-v3.md) | factory | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` | `UniswapV3.Factory` |
| [Uniswap V3](../protocols/uniswap-v3.md) | nonfungiblePositionManager | `0x1238536071E1c677A632429e3655c799b22cDA52` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../protocols/uniswap-v3.md) | quoterV2 | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | positionManager | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` | `UniswapV4.PositionManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` | `UniswapV4.StateView` |
| [Uniswap V4](../protocols/uniswap-v4.md) | universalRouter | `0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3` | `UniswapV4.UniversalRouter` |

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
