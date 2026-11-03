<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V2 (`uniswap-v2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Uniswap V2 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Constant product AMM (x*y=k) with permissionless pair creation. Deployed across 10 chains with identical interfaces.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV2` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |

## When to use it

- Constant-product pairs, one per token pair, with a 0.3% fee. Simple and everywhere, but with
  more price impact than a V3 pool for the same trade.
- The pair fills in full or reverts, so its Router, with an exact approval and `amountOutMin`,
  strands nothing. A Sauce program trades the pair itself with `@sauce/router`'s `uniswapV2`, with
  no Router and no approval.

## Pitfalls for a program

- `amountOutMin` is the only bound: there is no price limit.
- Through the Router, approve it for exactly `amountIn`, and give a `deadline`
  (`ctx.timestamp()` is this block). `uniswapV2` needs neither: it pushes the input to the pair.
- A fee-on-transfer token needs the Router's `...SupportingFeeOnTransferTokens` variants. Their
  swaps, such as `swapExactTokensForTokensSupportingFeeOnTransferTokens`, return nothing: measure
  what arrived.
- The pair must exist: `Factory.getPair` returns `0` where it does not.

## In a Sauce program

Sell the Pot's USDC for WETH at the pair:

```ts
import { uniswapV2 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address) {
  const pair = UniswapV2.Factory.getPair(USDC, WETH);
  require(pair != 0, "no USDC/WETH pair");
  uniswapV2(pair, USDC, WETH, amountIn, 3000, minOut, recipient);
}
```

`uniswapV2` prices the output from the pair's reserves with its 0.3% fee (`3000` ppm), pushes
`amountIn` to the pair, pays `recipient` and reverts below `minOut`. The pair takes the whole input
or the program reverts, so no input is left to return.

## What it offers

- **swap**: Swap an exact amount of input tokens for as many output tokens as possible, routed through a path of pairs
- **addLiquidity**: Deposit two tokens into a pair to mint LP tokens proportional to pool share
- **removeLiquidity**: Burn LP tokens to withdraw both underlying tokens from a pair

## Notes

- Path array defines the swap route: `[tokenIn, tokenOut]` for direct swaps, `[tokenIn, WETH, tokenOut]` for multi-hop through WETH
- 0.3% fee per hop, taken from input amount before swap
- Both tokens must be ERC20-approved to the Router before addLiquidity/swap
- LP tokens must be ERC20-approved to the Router before removeLiquidity
- For tokens with transfer taxes (fee-on-transfer), use `swapExactTokensForTokensSupportingFeeOnTransferTokens` instead (not in SDK but available on-chain)
- Prefer V3 for better capital efficiency, but V2 for maximum compatibility and simplicity
- On Arc (5042) the router's `WETH()` is a stub that always reverts with `UnsupportedProtocolError()`, so the ETH paths (`swapExactETHForTokens`, `addLiquidityETH`, …) revert. Trade USDC's ERC-20 `0x3600000000000000000000000000000000000000`; Arc's native coin is USDC and it has no canonical wrapped native
- From a Pot program, `@sauce/router` trades a Uniswap V2 pair directly, with no router and no approval: `uniswapV2(pair, tokenIn, tokenOut, amountIn, 3000, minOut, recipient)` reads the pair's `getReserves`, prices the output in the program with the pair's fee in parts per million, transfers the input to the pair and calls `pair.swap` with empty `data`, returning the amount out. The direction is the sort order of `tokenIn` and `tokenOut` (`token0` is the lower address), so there is no argument to get wrong. The swap consumes its whole input or reverts; there is no refund path. `tryUniswapV2` takes the same arguments and returns `0`, moving nothing, when the pair cannot fill the whole input at the floor. The `uniswapV2Swap` action is the same call

## Its names in a program

On Ethereum, `UniswapV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's factory, `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`.
  require(UniswapV2.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Ethereum](../chains/ethereum.md) | router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | `UniswapV2.Router` |
| [Optimism](../chains/optimism.md) | factory | `0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Optimism](../chains/optimism.md) | router | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` | `UniswapV2.Router` |
| [BNB Chain](../chains/bsc.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [BNB Chain](../chains/bsc.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Polygon](../chains/polygon.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Polygon](../chains/polygon.md) | router | `0xedf6066a2b290C185783862C7F4776A2C8077AD1` | `UniswapV2.Router` |
| [Arc](../chains/arc.md) | factory | `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Arc](../chains/arc.md) | router | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | `UniswapV2.Router` |
| [Base](../chains/base.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Base](../chains/base.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Arbitrum One](../chains/arbitrum.md) | factory | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Avalanche C-Chain](../chains/avalanche.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Avalanche C-Chain](../chains/avalanche.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Blast](../chains/blast.md) | factory | `0x5C346464d33F90bABaf70dB6388507CC889C1070` | `UniswapV2.Factory`; not on this deployment: `INIT_CODE_HASH` |
| [Blast](../chains/blast.md) | router | `0xBB66Eb1c5e875933D44DAe661dbD80e5D9B03035` | `UniswapV2.Router` |
| [Zora](../chains/zora.md) | factory | `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C` | `UniswapV2.Factory` |
| [Zora](../chains/zora.md) | router | `0xa00F34A632630EFd15223B1968358bA4845bEEC7` | `UniswapV2.Router` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `UniswapV2FactoryABI`

`import UniswapV2FactoryABI from "./protocols/uniswap-v2/UniswapV2FactoryABI.json";` Speaks for: factory.

- `allPairs(uint256) view returns (address)`
- `allPairsLength() view returns (uint256)`
- `createPair(address tokenA, address tokenB) returns (address pair)`
- `feeTo() view returns (address)`
- `feeToSetter() view returns (address)`
- `getPair(address tokenA, address tokenB) view returns (address pair)`: the address is a `UniswapV2.Pair`
- `INIT_CODE_HASH() view returns (bytes32)`
- `setFeeTo(address _feeTo)`
- `setFeeToSetter(address _feeToSetter)`

Not on Ethereum's factory (`0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Optimism's factory (`0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for Optimism is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on BNB Chain's factory (`0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for BNB Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Polygon's factory (`0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arc's factory (`0x89e5DB8B5aA49aA85AC63f691524311AEB649eba`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for Arc is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's factory (`0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's factory (`0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's factory (`0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Blast's factory (`0x5C346464d33F90bABaf70dB6388507CC889C1070`), whose code does not dispatch them or declares them otherwise: `INIT_CODE_HASH`. Do not call them there: a program compiled for Blast is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

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

`import UniswapV2RouterABI from "./protocols/uniswap-v2/UniswapV2RouterABI.json";` Speaks for: router.

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
