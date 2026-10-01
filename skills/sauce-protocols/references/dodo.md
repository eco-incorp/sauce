# DODO

Proactive Market Maker (PMM) DEX with capital-efficient liquidity provision. Unlike constant product AMMs, DODO uses oracle-guided pricing to concentrate liquidity near market price. Features single-token LP, customizable price curves, and smart routing across DODO pools.

## Category

dex | Chains: Ethereum, BSC

## Key Operations

- **swap**: Swap tokens via DODO V2 Proxy with pair-based routing

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/dodo";
```

## SauceScript Examples

### swap

```typescript
import { DODOV2ProxyABI as IDODOProxy } from "./abis";

function main(
  proxyAddress: Address,
  fromToken: Address,
  toToken: Address,
  fromAmount: Uint256,
  minReturn: Uint256,
  dodoPairs: Address[],
  direction: Uint256,
): Uint256 {
  const proxy = IDODOProxy.at(proxyAddress);
  return proxy.dodoSwapV2TokenToToken(
    fromToken,
    toToken,
    fromAmount,
    minReturn,
    dodoPairs,
    direction,
    false,
    99999999999,
  );
}
```

- `proxyAddress`: DODO V2 Proxy address for the target chain
- `fromToken`: Input token address
- `toToken`: Output token address
- `fromAmount`: Exact input amount (in wei)
- `minReturn`: Minimum output for slippage protection
- `dodoPairs`: Array of DODO pool addresses to route through (ordered for the swap path)
- `direction`: Bitmask encoding which side of each pool to use. Each bit represents a pool: `0` = sell base token, `1` = sell quote token. For a single pool, use `0` or `1`. For multi-pool, combine bits (e.g., `0b01` = first pool sell quote, second pool sell base)
- `isIncentive`: Set to `false` (incentive mining flag, usually disabled)

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | V2 Proxy | `0xa356867fDCeA8e71AEaf87805808803806231FDc` |
| BSC      | V2 Proxy | `0x8F8Dd7DB1bDA5eD3da8C9dAf3bFA471c12d58486` |

## ABI Methods

### DODOV2ProxyABI

- `dodoSwapV2TokenToToken(address fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, address[] dodoPairs, uint256 directions, bool isIncentive, uint256 deadLine) -> uint256 returnAmount` - Execute a token-to-token swap through one or more DODO pools

## Notes

- PMM (Proactive Market Maker) provides better capital efficiency than constant product by concentrating liquidity near oracle price
- `dodoPairs` is an array of DODO pool addresses defining the swap route (each pool has a base token and a quote token)
- `directions` is a bitmask: for each pool in the path, a bit value of `0` means "sell base token" and `1` means "sell quote token". The least significant bit corresponds to the first pool
- For a single-pool swap: if you're selling the base token of that pool, `directions = 0`; if selling the quote token, `directions = 1`
- `isIncentive`: Flag for DODO mining incentives, typically set to `false`
- Pool discovery requires off-chain lookup via DODO's API or subgraph to find the right pool addresses
- Input token must be ERC20-approved to the V2 Proxy contract
- DODO also supports single-token LP (provide only one side of liquidity) which is unique among AMMs
- From a Pot program, `@sauce/router` swaps at a DODO V2 pool (DVM, DPP or DSP) directly, with no proxy and no approval: `dodoV2(pool, tokenIn, tokenOut, amountIn, baseToken, quoteToken, minOut, recipient)` transfers the input to the pool and calls `sellBase(to)` when `tokenIn` is the base, `sellQuote(to)` when it is the quote, returning the amount out. The side cannot come from address order, and the wrong one reverts nothing and donates the input, so the function takes the pool's `_BASE_TOKEN_()` and `_QUOTE_TOKEN_()` and reverts unless `tokenIn` and `tokenOut` are those two. The pool books its whole balance as its reserve, so the swap consumes its input or reverts; name a `minOut`, since a thin pool pays out at most its quote reserve for any input. There is no `try` form: no capacity check guarantees the fill. The `dodoV2Swap` action is the same call; legacy V1 pairs are the `dodoV1Swap` action's, through the proxy
