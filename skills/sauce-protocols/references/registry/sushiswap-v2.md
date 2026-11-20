<!-- Generated from the SDK's registries. Do not edit. -->

# SushiSwap V2 (`sushiswap-v2`)

Community-driven fork of Uniswap V2 with additional yield farming features and multi-chain deployment.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Sushiswap`: `sushiswap-v2` |
| Namespace | `SushiswapV2` on ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Document | [sushiswap-v2.md](../sushiswap-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `SushiswapV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's factory, `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac`.
  require(SushiswapV2.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` | `SushiswapV2.Factory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` | `SushiswapV2.Router` |
| [Optimism](../../../sauce-chains/references/optimism.md) | factory | `0xFbc12984689e5f15626Bad03Ad60160Fe98B303C` | `SushiswapV2.Factory` |
| [Optimism](../../../sauce-chains/references/optimism.md) | router | `0x2ABf469074dc0b54d793850807E6eb5Faf2625b1` | `SushiswapV2.Router` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Polygon](../../../sauce-chains/references/polygon.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Fantom](../../../sauce-chains/references/fantom.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Fantom](../../../sauce-chains/references/fantom.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `SushiSwapV2FactoryABI`

`import SushiSwapV2FactoryABI from "./protocols/sushiswap-v2/SushiSwapV2FactoryABI.json";` Speaks for: factory. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `SushiswapV2` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `allPairs(uint256) view returns (address)`
- `allPairsLength() view returns (uint256)`
- `createPair(address tokenA, address tokenB) returns (address pair)`
- `feeTo() view returns (address)`
- `feeToSetter() view returns (address)`
- `getPair(address tokenA, address tokenB) view returns (address pair)`: the address is a `SushiswapV2.Pair`
- `migrator() view returns (address)`
- `pairCodeHash() pure returns (bytes32)`
- `setFeeTo(address _feeTo)`
- `setFeeToSetter(address _feeToSetter)`
- `setMigrator(address _migrator)`

### `SushiSwapV2PairABI`

`import SushiSwapV2PairABI from "./protocols/sushiswap-v2/SushiSwapV2PairABI.json";`

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

### `SushiSwapV2RouterABI`

`import SushiSwapV2RouterABI from "./protocols/sushiswap-v2/SushiSwapV2RouterABI.json";` Speaks for: router. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `SushiswapV2` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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
