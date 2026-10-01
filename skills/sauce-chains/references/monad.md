<!-- Generated from the SDK's registries. Do not edit. -->

# Monad

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `monad` |
| Chain id | 143 |
| Kind | EVM |
| Name in a program | `Monad` |
| Native coin | not recorded |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |
| CCTP domain | 15 |

## In a program

Compiled with `--chain monad`, a program names Monad's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=monad
function main() {
  // `USDC` is Monad's USDC: `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`.
  const held = USDC.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(ctx.self()) == held);
  // `AaveV3.Pool` is Monad's pool: `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef`.
  require(AaveV3.Pool != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Monad.AaveV3.Pool == AaveV3.Pool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 |
| `WMON` | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` | 18 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` | `AaveV3.Pool` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | poolAddressesProvider | `0x34793Fb9935F7bB5E5aE920fb963F39063E7A615` | no registry ABI |
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Morpho Blue](../../sauce-protocols/references/registry/morpho-blue.md) | morpho | `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` | `MorphoBlue.Morpho` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | router | `0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9` | `PancakeswapV2.Router` |
| [Pendle](../../sauce-protocols/references/registry/pendle.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Permit2](../../sauce-protocols/references/registry/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0x204faca1764b154221e35c0d20abb3c525710498` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | nonfungiblePositionManager | `0x7197e214c0b767cfb76fb734ab638e2c192f4e53` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | quoterV2 | `0x661e93cca42afacb172121ef892830ca3b70f08d` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter02 | `0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x188d586ddcf52439676ca21a244753fa19f9ea8e` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | positionManager | `0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016` | `UniswapV4.PositionManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | universalRouter | `0x0d97dc33264bfc1c226207428a79b26757fb9dc3` | `UniswapV4.UniversalRouter` |
