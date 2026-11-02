<!-- Generated from the SDK's registries. Do not edit. -->

# SushiSwap V2 (`sushiswap-v2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> SushiSwap V2 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Community-driven fork of Uniswap V2 with additional yield farming features and multi-chain deployment. Identical AMM interface to Uniswap V2 (x*y=k constant product) with broader L2 and alt-chain coverage.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Sushiswap`: `sushiswap-v2` |
| Namespace | `SushiswapV2` on ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |

## When to use it

- A Uniswap V2 fork: constant-product pairs, 0.3% fee, the same Router interface. Use it where
  its pair is deeper than Uniswap V2's on the chain.

## Pitfalls for a program

- As Uniswap V2: `amountOutMin` is the only bound; through the Router, approve exactly
  `amountIn` and pass a deadline.

## In a Sauce program

Sell the Pot's USDC for WETH at the pair:

```ts
import { uniswapV2 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address) {
  const pair = SushiswapV2.Factory.getPair(USDC, WETH);
  require(pair != 0, "no USDC/WETH pair");
  uniswapV2(pair, USDC, WETH, amountIn, 3000, minOut, recipient);
}
```

`uniswapV2` prices the output from the pair's reserves with its 0.3% fee (`3000` ppm), pushes
`amountIn` to the pair, pays `recipient` and reverts below `minOut`. The pair takes the whole input
or the program reverts, so no input is left to return.

## What it offers

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint SLP (SushiSwap LP) tokens
- **removeLiquidity**: Burn SLP tokens to withdraw underlying tokens

## Notes

- Interface is identical to Uniswap V2; same 0.3% fee per hop
- Factory and Router addresses are consistent across Arbitrum, Polygon, BSC, Avalanche, and Fantom
- SLP tokens can be staked in SushiSwap's MasterChef/MiniChef contracts for SUSHI rewards (not in SDK)
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity
- Use SushiSwap when Uniswap V2 is not deployed on the target chain, or when SUSHI farming incentives are active
- From a Pot program, `@sauce/router` trades a SushiSwap V2 pair directly, with no router and no approval: `uniswapV2(pair, tokenIn, tokenOut, amountIn, 3000, minOut, recipient)` reads the pair's `getReserves`, prices the output in the program with the pair's fee in parts per million, transfers the input to the pair and calls `pair.swap` with empty `data`, returning the amount out. The direction is the sort order of `tokenIn` and `tokenOut` (`token0` is the lower address), so there is no argument to get wrong. The swap consumes its whole input or reverts; there is no refund path. `tryUniswapV2` takes the same arguments and returns `0`, moving nothing, when the pair cannot fill the whole input at the floor. The `uniswapV2Swap` action is the same call

## Its names in a program

On Ethereum, `SushiswapV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's factory, `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac`.
  require(SushiswapV2.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | factory | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` | `SushiswapV2.Factory` |
| [Ethereum](../chains/ethereum.md) | router | `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` | `SushiswapV2.Router` |
| [Optimism](../chains/optimism.md) | factory | `0xFbc12984689e5f15626Bad03Ad60160Fe98B303C` | `SushiswapV2.Factory` |
| [Optimism](../chains/optimism.md) | router | `0x2ABf469074dc0b54d793850807E6eb5Faf2625b1` | `SushiswapV2.Router` |
| [BNB Chain](../chains/bsc.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [BNB Chain](../chains/bsc.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Polygon](../chains/polygon.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Polygon](../chains/polygon.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Fantom](../chains/fantom.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Fantom](../chains/fantom.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Arbitrum One](../chains/arbitrum.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Avalanche C-Chain](../chains/avalanche.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Avalanche C-Chain](../chains/avalanche.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `SushiSwapV2FactoryABI`

`import SushiSwapV2FactoryABI from "./protocols/sushiswap-v2/SushiSwapV2FactoryABI.json";` Speaks for: factory.

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

`import SushiSwapV2RouterABI from "./protocols/sushiswap-v2/SushiSwapV2RouterABI.json";` Speaks for: router.

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
