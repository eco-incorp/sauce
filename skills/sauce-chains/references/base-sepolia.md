<!-- Generated from the SDK's registries. Do not edit. -->

# Base Sepolia

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
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |
| CCTP domain | 6 |

## In a program

Compiled with `--chain base-sepolia`, a program names Base Sepolia's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=base-sepolia
function main() {
  // `USDC` is Base Sepolia's USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
  const held = USDC.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(pot) == held);
  // `AaveV3.Pool` is Base Sepolia's pool: `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(BaseSepolia.AaveV3.Pool == AaveV3.Pool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 |
| `WETH` | `0x4200000000000000000000000000000000000006` | 18 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` | `AaveV3.Pool` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | poolAddressesProvider | `0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00` | `AaveV3.PoolAddressesProvider` |
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | nonfungiblePositionManager | `0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | quoterV2 | `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter02 | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | positionManager | `0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80` | `UniswapV4.PositionManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4` | `UniswapV4.StateView` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | universalRouter | `0x8702463e73f74d0b6765aBceb314Ef07aCb92650` | `UniswapV4.UniversalRouter` |
