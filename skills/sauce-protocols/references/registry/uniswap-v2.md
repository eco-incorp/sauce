<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V2 (`uniswap-v2`)

Constant product AMM (x*y=k) with permissionless pair creation. The most forked DEX protocol in DeFi.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV2` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| Document | [uniswap-v2.md](../uniswap-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `UniswapV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's factory, `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`.
  require(UniswapV2.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | `UniswapV2.Router` |
| [Optimism](../../../sauce-chains/references/optimism.md) | factory | `0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Optimism](../../../sauce-chains/references/optimism.md) | router | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` | `UniswapV2.Router` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Polygon](../../../sauce-chains/references/polygon.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Polygon](../../../sauce-chains/references/polygon.md) | router | `0xedf6066a2b290C185783862C7F4776A2C8077AD1` | `UniswapV2.Router` |
| [Arc](../../../sauce-chains/references/arc.md) | factory | `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Arc](../../../sauce-chains/references/arc.md) | router | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | `UniswapV2.Router` |
| [Base](../../../sauce-chains/references/base.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Base](../../../sauce-chains/references/base.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | factory | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Blast](../../../sauce-chains/references/blast.md) | factory | `0x5C346464d33F90bABaf70dB6388507CC889C1070` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Blast](../../../sauce-chains/references/blast.md) | router | `0xBB66Eb1c5e875933D44DAe661dbD80e5D9B03035` | `UniswapV2.Router` |
| [Zora](../../../sauce-chains/references/zora.md) | factory | `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C` | `UniswapV2.Factory` |
| [Zora](../../../sauce-chains/references/zora.md) | router | `0xa00F34A632630EFd15223B1968358bA4845bEEC7` | `UniswapV2.Router` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `UniswapV2FactoryABI`

`import UniswapV2FactoryABI from "./protocols/uniswap-v2/UniswapV2FactoryABI.json";` Speaks for: factory. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UniswapV2` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `allPairs(uint256) view returns (address)`
- `allPairsLength() view returns (uint256)`
- `createPair(address tokenA, address tokenB) returns (address pair)`
- `feeTo() view returns (address)`
- `feeToSetter() view returns (address)`
- `getPair(address tokenA, address tokenB) view returns (address pair)`: the address is a `UniswapV2.Pair`
- `INIT_CODE_HASH() view returns (bytes32)`
- `setFeeTo(address _feeTo)`
- `setFeeToSetter(address _feeToSetter)`

Not on Ethereum's factory (`0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Optimism's factory (`0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for Optimism is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on BNB Chain's factory (`0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for BNB Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Polygon's factory (`0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arc's factory (`0x89e5DB8B5aA49aA85AC63f691524311AEB649eba`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for Arc is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's factory (`0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's factory (`0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's factory (`0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Blast's factory (`0x5C346464d33F90bABaf70dB6388507CC889C1070`), whose code does not dispatch them or does not declare them as listed here: `INIT_CODE_HASH`. Do not call them there: a program compiled for Blast is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

### `UniswapV2PairABI`

`import UniswapV2PairABI from "./protocols/uniswap-v2/UniswapV2PairABI.json";`

- `allowance(address, address) view returns (uint256)`
- `approve(address spender, uint256 value) returns (bool)`
- `balanceOf(address) view returns (uint256)`
- `burn(address to) returns (uint256 amount0, uint256 amount1)`
- `decimals() view returns (uint8)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `factory() view returns (address)`
- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)`
- `initialize(address _token0, address _token1)`
- `kLast() view returns (uint256)`
- `MINIMUM_LIQUIDITY() view returns (uint256)`
- `mint(address to) returns (uint256 liquidity)`
- `name() view returns (string)`
- `nonces(address) view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `PERMIT_TYPEHASH() view returns (bytes32)`
- `price0CumulativeLast() view returns (uint256)`
- `price1CumulativeLast() view returns (uint256)`
- `skim(address to)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`
- `symbol() view returns (string)`
- `sync()`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 value) returns (bool)`
- `transferFrom(address from, address to, uint256 value) returns (bool)`

### `UniswapV2RouterABI`

`import UniswapV2RouterABI from "./protocols/uniswap-v2/UniswapV2RouterABI.json";` Speaks for: router. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UniswapV2` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)`
- `factory() view returns (address)`
- `getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) pure returns (uint256 amountIn)`
- `getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256 amountOut)`
- `getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)`
- `getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)`
- `quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256 amountB)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountETH)`
- `removeLiquidityETHWithPermit(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountETH)`
- `removeLiquidityWithPermit(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountA, uint256 amountB)`
- `swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)`
- `swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)`
- `swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable`
- `swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)`
- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)`
- `swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `WETH() view returns (address)`
