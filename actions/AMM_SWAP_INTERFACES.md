# AMM Swap Interfaces on Ethereum Mainnet

A comprehensive reference of all unique AMM protocols and their Solidity swap interfaces.

---

## Table of Contents

1. [Uniswap](#1-uniswap)
   - [V2 Router](#uniswap-v2-router)
   - [V3 SwapRouter](#uniswap-v3-swaprouter)
   - [V4 Universal Router](#uniswap-v4-universal-router)
2. [Curve Finance](#2-curve-finance)
   - [StableSwap Pools](#stableswap-pools)
   - [CryptoSwap (V2) Pools](#cryptoswap-v2-pools)
   - [Curve Router (Legacy)](#curve-registry-exchange-legacy-router)
   - [Curve RouterNG](#curve-routerng)
3. [Balancer](#3-balancer)
   - [V2 Vault](#balancer-v2-vault)
   - [V3 Router / BatchRouter](#balancer-v3)
4. [Ambient (CrocSwap)](#4-ambient-crocswap)
5. [DODO](#5-dodo)
6. [Maverick Protocol](#6-maverick-protocol)
7. [Carbon (Bancor)](#7-carbon-bancor)
8. [Fraxswap](#8-fraxswap)
9. [Clipper](#9-clipper)
10. [Integral](#10-integral)
11. [Fluid DEX (Instadapp)](#11-fluid-dex-instadapp)
    - [DEX T1 Pool Swaps](#fluid-dex-t1-pool-swaps)
    - [DEX Lite (Singleton)](#fluid-dex-lite-singleton)
11. [Fluid DEX (Instadapp)](#11-fluid-dex-instadapp)
    - [DEX T1 Pool Swaps](#fluid-dex-t1-pool-swaps)
    - [DEX Lite (Singleton)](#fluid-dex-lite-singleton)

---

## 1. Uniswap

### Uniswap V2 Router

**Address:** `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`

#### swapExactTokensForTokens

```solidity
function swapExactTokensForTokens(
    uint amountIn,          // exact amount of input tokens to send
    uint amountOutMin,      // minimum output tokens to receive (slippage protection)
    address[] calldata path,// token addresses defining the swap route (e.g. [tokenA, tokenB])
    address to,             // recipient of the output tokens
    uint deadline           // unix timestamp after which the tx reverts
) external returns (uint[] memory amounts);
```

#### swapTokensForExactTokens

```solidity
function swapTokensForExactTokens(
    uint amountOut,         // exact amount of output tokens desired
    uint amountInMax,       // maximum input tokens willing to spend (slippage protection)
    address[] calldata path,// token addresses defining the swap route
    address to,             // recipient of the output tokens
    uint deadline           // unix timestamp after which the tx reverts
) external returns (uint[] memory amounts);
```

#### swapExactETHForTokens

```solidity
function swapExactETHForTokens(
    uint amountOutMin,      // minimum output tokens to receive
    address[] calldata path,// swap route; path[0] must be WETH
    address to,             // recipient
    uint deadline           // expiry timestamp
) external payable returns (uint[] memory amounts);
// msg.value is the exact ETH input amount
```

#### swapTokensForExactETH

```solidity
function swapTokensForExactETH(
    uint amountOut,         // exact ETH output desired
    uint amountInMax,       // maximum input tokens willing to spend
    address[] calldata path,// swap route; path[last] must be WETH
    address to,             // recipient of ETH
    uint deadline           // expiry timestamp
) external returns (uint[] memory amounts);
```

#### swapExactTokensForETH

```solidity
function swapExactTokensForETH(
    uint amountIn,          // exact input token amount
    uint amountOutMin,      // minimum ETH output
    address[] calldata path,// swap route; path[last] must be WETH
    address to,             // recipient of ETH
    uint deadline           // expiry timestamp
) external returns (uint[] memory amounts);
```

#### swapETHForExactTokens

```solidity
function swapETHForExactTokens(
    uint amountOut,         // exact output tokens desired
    address[] calldata path,// swap route; path[0] must be WETH
    address to,             // recipient
    uint deadline           // expiry timestamp
) external payable returns (uint[] memory amounts);
// msg.value is the maximum ETH willing to spend; excess is refunded
```

#### Fee-on-Transfer Token Variants

These do not return `amounts` because fee-on-transfer tokens make output amounts unpredictable. Only "exact input" variants exist.

```solidity
function swapExactTokensForTokensSupportingFeeOnTransferTokens(
    uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline
) external;

function swapExactETHForTokensSupportingFeeOnTransferTokens(
    uint amountOutMin, address[] calldata path, address to, uint deadline
) external payable;

function swapExactTokensForETHSupportingFeeOnTransferTokens(
    uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline
) external;
```

---

### Uniswap V3 SwapRouter

**Address:** `0xE592427A0AEce92De3Edee1F18E0157C05861564`

#### Structs

```solidity
struct ExactInputSingleParams {
    address tokenIn;            // input token address
    address tokenOut;           // output token address
    uint24 fee;                 // pool fee tier (500, 3000, or 10000 = 0.05%, 0.3%, 1%)
    address recipient;          // address receiving output tokens
    uint256 deadline;           // unix timestamp expiry
    uint256 amountIn;           // exact input amount
    uint256 amountOutMinimum;   // minimum output (slippage protection)
    uint160 sqrtPriceLimitX96;  // price limit for the swap; 0 for no limit
}

struct ExactInputParams {
    bytes path;                 // abi.encodePacked(tokenIn, fee, tokenMiddle, fee, tokenOut)
    address recipient;          // address receiving output tokens
    uint256 deadline;           // unix timestamp expiry
    uint256 amountIn;           // exact input amount
    uint256 amountOutMinimum;   // minimum output (slippage protection)
}

struct ExactOutputSingleParams {
    address tokenIn;            // input token address
    address tokenOut;           // output token address
    uint24 fee;                 // pool fee tier
    address recipient;          // address receiving output tokens
    uint256 deadline;           // unix timestamp expiry
    uint256 amountOut;          // exact output amount desired
    uint256 amountInMaximum;    // maximum input willing to spend (slippage protection)
    uint160 sqrtPriceLimitX96;  // price limit; 0 for no limit
}

struct ExactOutputParams {
    bytes path;                 // encoded multi-hop path (reversed order: tokenOut, fee, ..., tokenIn)
    address recipient;          // address receiving output tokens
    uint256 deadline;           // unix timestamp expiry
    uint256 amountOut;          // exact output amount desired
    uint256 amountInMaximum;    // maximum input willing to spend
}
```

#### Functions

```solidity
function exactInputSingle(ExactInputSingleParams calldata params)
    external payable returns (uint256 amountOut);

function exactInput(ExactInputParams calldata params)
    external payable returns (uint256 amountOut);

function exactOutputSingle(ExactOutputSingleParams calldata params)
    external payable returns (uint256 amountIn);

function exactOutput(ExactOutputParams calldata params)
    external payable returns (uint256 amountIn);
```

---

### Uniswap V4 Universal Router

**Address:** `0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af`

#### Top-Level Execute Function

```solidity
function execute(
    bytes calldata commands,    // packed bytes where each byte is a command ID
    bytes[] calldata inputs,    // array of abi-encoded parameters, one per command
    uint256 deadline            // unix timestamp expiry
) external payable;
```

- `commands[i]` is a single byte identifying the command type
- `inputs[i]` is the ABI-encoded parameters for that command
- The high bit (`0x80`) is `FLAG_ALLOW_REVERT`; lower 7 bits are the command type

#### Swap Command IDs

| Command | Value | Input Encoding |
|---------|-------|----------------|
| `V3_SWAP_EXACT_IN` | `0x00` | `abi.encode(address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)` |
| `V3_SWAP_EXACT_OUT` | `0x01` | `abi.encode(address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser)` |
| `V2_SWAP_EXACT_IN` | `0x08` | `abi.encode(address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser)` |
| `V2_SWAP_EXACT_OUT` | `0x09` | `abi.encode(address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool payerIsUser)` |
| `V4_SWAP` | `0x10` | `abi.encode(bytes actions, bytes[] params)` |

- **payerIsUser**: `true` = tokens pulled from `msg.sender` via Permit2; `false` = tokens taken from router balance (for chaining commands like `WRAP_ETH`)

#### V4_SWAP Sub-Actions

| Action | Value | Params |
|--------|-------|--------|
| `SWAP_EXACT_IN_SINGLE` | `0x06` | `ExactInputSingleParams` |
| `SWAP_EXACT_IN` | `0x07` | `ExactInputParams` |
| `SWAP_EXACT_OUT_SINGLE` | `0x08` | `ExactOutputSingleParams` |
| `SWAP_EXACT_OUT` | `0x09` | `ExactOutputParams` |
| `SETTLE_ALL` | `0x0c` | `abi.encode(Currency currency, uint256 maxAmount)` |
| `SETTLE` | `0x0b` | `abi.encode(Currency currency, uint256 amount, bool payerIsUser)` |
| `TAKE_ALL` | `0x0f` | `abi.encode(Currency currency, uint256 minAmount)` |
| `TAKE` | `0x0e` | `abi.encode(Currency currency, address recipient, uint256 amount)` |

#### V4 Structs

```solidity
struct PoolKey {
    Currency currency0;     // lower-sorted token address (address(0) for native ETH)
    Currency currency1;     // higher-sorted token address
    uint24 fee;             // LP fee; 0x800000 = dynamic fee
    int24 tickSpacing;      // tick spacing for the pool
    IHooks hooks;           // hook contract address (address(0) for none)
}

struct PathKey {
    Currency intermediateCurrency;  // next token in the path
    uint24 fee;                     // pool fee tier
    int24 tickSpacing;              // tick spacing
    IHooks hooks;                   // hook contract
    bytes hookData;                 // arbitrary data passed to hooks
}

struct ExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;            // true = swap currency0 → currency1
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;     // minimum price threshold (scaled by 1e36)
    bytes hookData;
}

struct ExactInputParams {
    Currency currencyIn;
    PathKey[] path;
    uint256[] minHopPriceX36;   // per-hop minimum price thresholds
    uint128 amountIn;
    uint128 amountOutMinimum;
}

struct ExactOutputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountOut;
    uint128 amountInMaximum;
    uint256 minHopPriceX36;
    bytes hookData;
}

struct ExactOutputParams {
    Currency currencyOut;
    PathKey[] path;             // reversed: output to input
    uint256[] minHopPriceX36;
    uint128 amountOut;
    uint128 amountInMaximum;
}
```

#### Typical V4 Swap Flow

```
// Sub-actions for a single-hop exact-input swap:
actions = abi.encodePacked(
    uint8(0x06),  // SWAP_EXACT_IN_SINGLE
    uint8(0x0c),  // SETTLE_ALL
    uint8(0x0f)   // TAKE_ALL
);
params[0] = abi.encode(ExactInputSingleParams({...}));
params[1] = abi.encode(currencyIn, maxAmountIn);
params[2] = abi.encode(currencyOut, minAmountOut);

// Wrap as Universal Router command:
commands = abi.encodePacked(uint8(0x10));  // V4_SWAP
inputs[0] = abi.encode(actions, params);
```

#### Utility Commands

| Command | Value | Input Encoding |
|---------|-------|----------------|
| `WRAP_ETH` | `0x0b` | `abi.encode(address recipient, uint256 amountMin)` |
| `UNWRAP_WETH` | `0x0c` | `abi.encode(address recipient, uint256 amountMin)` |
| `PERMIT2_TRANSFER_FROM` | `0x02` | `abi.encode(address token, address recipient, uint160 amount)` |
| `SWEEP` | `0x04` | `abi.encode(address token, address recipient, uint256 amountMin)` |

---

## 2. Curve Finance

### StableSwap Pools

Classic pools for pegged assets (e.g., 3pool, stETH/ETH). Indices use `int128`.

#### exchange

```solidity
function exchange(
    int128 i,        // index of the input coin (discoverable via coins(uint256) getter)
    int128 j,        // index of the output coin
    uint256 dx,      // amount of coin i to sell
    uint256 min_dy   // minimum amount of coin j to receive (slippage protection)
) external payable returns (uint256);
```

The function is `payable` for pools containing native ETH.

#### exchange_underlying

```solidity
function exchange_underlying(
    int128 i,        // index of the input underlying coin
    int128 j,        // index of the output underlying coin
    uint256 dx,      // amount of underlying coin i to sell
    uint256 min_dy   // minimum amount of underlying coin j to receive
) external returns (uint256);
```

Exists on **lending pools** (e.g., Compound, Aave) and **metapools**. Swaps the underlying tokens (e.g., DAI instead of cDAI). Indices via `underlying_coins(uint256)`.

---

### CryptoSwap (V2) Pools

For non-pegged volatile asset pairs (e.g., tricrypto2). Indices use `uint256`.

#### exchange

```solidity
// Multiple overloads exist depending on the pool:
function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external payable returns (uint256);
function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy, bool use_eth) external payable returns (uint256);
function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy, bool use_eth, address receiver) external payable returns (uint256);
```

| Parameter | Description |
|-----------|-------------|
| `i` | Index of the input coin |
| `j` | Index of the output coin |
| `dx` | Amount of coin `i` to sell |
| `min_dy` | Minimum amount of coin `j` to receive |
| `use_eth` | If `true`, use native ETH instead of WETH (default: `false`) |
| `receiver` | Address that receives output tokens (default: `msg.sender`) |

#### exchange_underlying

```solidity
function exchange_underlying(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external returns (uint256);
function exchange_underlying(uint256 i, uint256 j, uint256 dx, uint256 min_dy, address receiver) external returns (uint256);
```

---

### Curve Registry Exchange (Legacy Router)

**Address:** `0x99a58482BD75cbab83b27EC03CA68fF489b5788f`

Supports up to 4 swaps in a single transaction.

#### exchange_multiple

```solidity
function exchange_multiple(
    address[9] calldata _route,         // routing path: [tokenIn, pool1, tokenMid1, pool2, tokenMid2, ...]
    uint256[3][4] calldata _swap_params,// per-swap: [i, j, swap_type]
    uint256 _amount,                    // amount of _route[0] to send
    uint256 _expected,                  // minimum final output amount
    address[4] calldata _pools,         // pool addresses for zap contracts (optional)
    address _receiver                   // recipient (optional, defaults to msg.sender)
) external payable returns (uint256);
```

**swap_type values:**

| Value | Meaning |
|-------|---------|
| 1 | StableSwap `exchange` |
| 2 | StableSwap `exchange_underlying` |
| 3 | CryptoSwap `exchange` |
| 4 | CryptoSwap `exchange_underlying` |
| 5 | Factory metapool `exchange_underlying` |
| 6 | Factory crypto-meta `exchange_underlying` |
| 15 | WETH ↔ ETH |

---

### Curve RouterNG

Newer router supporting up to 5 swaps.

#### exchange

```solidity
function exchange(
    address[11] calldata _route,          // routing path (up to 5 hops)
    uint256[5][5] calldata _swap_params,  // per-swap: [i, j, swap_type, pool_type, n_coins]
    uint256 _amount,                      // amount of _route[0] to send
    uint256 _expected,                    // minimum final output amount
    address[5] calldata _pools,           // actual pool addresses when using zaps (optional)
    address _receiver                     // recipient (optional)
) external payable returns (uint256);
```

**swap_type values (RouterNG):**

| Value | Meaning |
|-------|---------|
| 1 | StableSwap `exchange` |
| 2 | StableSwap `exchange_underlying` |
| 3 | Underlying exchange via zap |
| 4 | Coin → LP token (`add_liquidity`) |
| 5 | Lending underlying → LP token |
| 6 | LP token → coin (`remove_liquidity_one_coin`) |
| 7 | LP token → lending underlying |
| 8 | ETH ↔ WETH, ETH → stETH, stETH ↔ wstETH, etc. |

**pool_type values:** 1 = StableSwap, 2 = CryptoSwap (2-coin), 3 = Tricrypto

**n_coins:** Number of coins in the pool (2, 3, 4).

---

## 3. Balancer

### Balancer V2 Vault

**Address:** `0xBA12222222228d8Ba445958a75a0704d566BF2C8`

#### Enums & Structs

```solidity
enum SwapKind { GIVEN_IN, GIVEN_OUT }

struct SingleSwap {
    bytes32 poolId;       // unique identifier of the pool
    SwapKind kind;        // GIVEN_IN = exact input, GIVEN_OUT = exact output
    IAsset assetIn;       // token sent to the pool (address(0) for ETH)
    IAsset assetOut;      // token received from the pool
    uint256 amount;       // for GIVEN_IN: exact input; for GIVEN_OUT: exact output
    bytes userData;       // pool-specific extra data (usually "0x")
}

struct BatchSwapStep {
    bytes32 poolId;       // pool to swap through
    uint256 assetInIndex; // index of input token in the assets array
    uint256 assetOutIndex;// index of output token in the assets array
    uint256 amount;       // amount for this step; 0 = use output of previous step
    bytes userData;       // pool-specific extra data
}

struct FundManagement {
    address sender;              // address sending tokens to the Vault
    bool fromInternalBalance;    // if true, use sender's Vault internal balance
    address payable recipient;   // address receiving tokens from the Vault
    bool toInternalBalance;      // if true, deposit output into recipient's internal balance
}
```

#### swap (single pool)

```solidity
function swap(
    SingleSwap memory singleSwap,
    FundManagement memory funds,
    uint256 limit,      // GIVEN_IN: minimum output; GIVEN_OUT: maximum input
    uint256 deadline    // unix timestamp after which tx reverts
) external payable returns (uint256);
```

#### batchSwap (multi-hop)

```solidity
function batchSwap(
    SwapKind kind,
    BatchSwapStep[] memory swaps,     // ordered array of swap steps
    IAsset[] memory assets,           // all tokens involved (referenced by index)
    FundManagement memory funds,
    int256[] memory limits,           // per-asset: positive = max sent, negative = min received
    uint256 deadline
) external payable returns (int256[] memory assetDeltas);
```

---

### Balancer V3

**Vault Address:** `0xbA1333333333a1BA1108E8412f11850A5C319bA9`

V3 uses Router contracts as entry points instead of calling the Vault directly.

#### Structs

```solidity
enum SwapKind { EXACT_IN, EXACT_OUT }

struct SwapPathStep {
    address pool;       // pool to swap through (or ERC4626 token if isBuffer=true)
    IERC20 tokenOut;    // output token for this step
    bool isBuffer;      // if true, the "pool" is an ERC4626 buffer for wrap/unwrap
}

struct SwapPathExactAmountIn {
    IERC20 tokenIn;
    SwapPathStep[] steps;
    uint256 exactAmountIn;
    uint256 minAmountOut;
}

struct SwapPathExactAmountOut {
    IERC20 tokenIn;
    SwapPathStep[] steps;
    uint256 maxAmountIn;
    uint256 exactAmountOut;
}
```

#### Router — swapSingleTokenExactIn

```solidity
function swapSingleTokenExactIn(
    address pool,              // pool to swap through
    IERC20 tokenIn,
    IERC20 tokenOut,
    uint256 exactAmountIn,
    uint256 minAmountOut,
    uint256 deadline,
    bool wethIsEth,            // if true, auto wraps/unwraps ETH↔WETH
    bytes calldata userData
) external payable returns (uint256 amountOut);
```

#### Router — swapSingleTokenExactOut

```solidity
function swapSingleTokenExactOut(
    address pool,
    IERC20 tokenIn,
    IERC20 tokenOut,
    uint256 exactAmountOut,
    uint256 maxAmountIn,
    uint256 deadline,
    bool wethIsEth,
    bytes calldata userData
) external payable returns (uint256 amountIn);
```

#### BatchRouter — swapExactIn

```solidity
function swapExactIn(
    SwapPathExactAmountIn[] memory paths,
    uint256 deadline,
    bool wethIsEth,
    bytes calldata userData
) external payable returns (
    uint256[] memory pathAmountsOut,
    address[] memory tokensOut,
    uint256[] memory amountsOut
);
```

#### BatchRouter — swapExactOut

```solidity
function swapExactOut(
    SwapPathExactAmountOut[] memory paths,
    uint256 deadline,
    bool wethIsEth,
    bytes calldata userData
) external payable returns (
    uint256[] memory pathAmountsIn,
    address[] memory tokensIn,
    uint256[] memory amountsIn
);
```

---

## 4. Ambient (CrocSwap)

**CrocSwapDex Address:** `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688`
**CrocSwapRouter Address:** `0x533E164ded63f4c55E83E1f409BDf2BaC5278035`

#### swap (direct, deprecated on some deployments)

```solidity
function swap(
    address base,          // base token address (address(0) for native ETH)
    address quote,         // quote token address (must be numerically > base)
    uint256 poolIdx,       // pool type index (e.g., 420 for standard pool)
    bool isBuy,            // true = paying base, receiving quote; false = opposite
    bool inBaseQty,        // true = qty denominated in base token; false = quote token
    uint128 qty,           // amount to swap
    uint16 tip,            // 0 = accept pool default fee; non-zero = max fee rate accepted
    uint128 limitPrice,    // worst acceptable price as Q64.64 sqrt price
    uint128 minOut,        // minimum output tokens; reverts if not met
    uint8 reserveFlags     // 0x1 = use surplus for base, 0x2 = use surplus for quote
) public payable returns (int128 baseFlow, int128 quoteFlow);
```

#### userCmd (recommended method)

```solidity
function userCmd(uint16 callpath, bytes calldata cmd) external payable returns (bytes memory);
```

For swaps, use `callpath = 1` with cmd encoded as:

```solidity
cmd = abi.encode(base, quote, poolIdx, isBuy, inBaseQty, qty, tip, limitPrice, minOut, settleFlags);
```

Parameters are identical to the `swap()` function above.

---

## 5. DODO

**DODO V2 Proxy Address:** `0xa356867fDCEa8e71AEaF87805808803806231FdC`

### Router-Level Functions (DODOProxy)

#### dodoSwapV2TokenToToken

```solidity
function dodoSwapV2TokenToToken(
    address fromToken,              // input token address
    address toToken,                // output token address
    uint256 fromTokenAmount,        // amount of input token to swap
    uint256 minReturnAmount,        // minimum output; reverts if not met
    address[] memory dodoPairs,     // ordered array of DODO pool addresses forming the route
    uint256 directions,             // bitmask: bit i = 0 → sellBase at pool i; bit i = 1 → sellQuote
    bool isIncentive,               // DODO mining incentive flag (generally false)
    uint256 deadLine                // unix timestamp deadline
) external returns (uint256 returnAmount);
```

#### dodoSwapV2ETHToToken

```solidity
function dodoSwapV2ETHToToken(
    address toToken,
    uint256 minReturnAmount,
    address[] memory dodoPairs,
    uint256 directions,
    bool isIncentive,
    uint256 deadLine
) external payable returns (uint256 returnAmount);
// msg.value is the ETH input amount
```

#### dodoSwapV2TokenToETH

```solidity
function dodoSwapV2TokenToETH(
    address fromToken,
    uint256 fromTokenAmount,
    uint256 minReturnAmount,
    address[] memory dodoPairs,
    uint256 directions,
    bool isIncentive,
    uint256 deadLine
) external returns (uint256 returnAmount);
```

### Direct Pool-Level Functions (DVM / DSP / DPP)

```solidity
// Transfer input tokens to the pool first, then call:
function sellBase(address to) external returns (uint256 receiveQuoteAmount);
function sellQuote(address to) external returns (uint256 receiveBaseAmount);
```

- `to` — recipient address for output tokens
- The pool calculates swap amount based on balance difference

---

## 6. Maverick Protocol

**Maverick V2 Router Address:** `0xbbF1EE38152E9D8E3470Dc47947eAa65DCA94913`

### Pool-Level Swap

```solidity
struct SwapParams {
    uint256 amount;      // input amount (if !exactOutput) or output amount (if exactOutput)
    bool tokenAIn;       // true = tokenA is input; false = tokenB is input
    bool exactOutput;    // true = amount is desired output; false = amount is input to spend
    int32 tickLimit;     // price tick limit (analogous to sqrtPriceLimitX96 in Uni V3)
}

function swap(
    address recipient,
    SwapParams memory params,
    bytes calldata data          // callback data; if non-empty, triggers maverickV2SwapCallback
) external returns (uint256 amountIn, uint256 amountOut);
```

### Router Functions

#### exactInputSingle

```solidity
function exactInputSingle(
    address recipient,
    IMaverickV2Pool pool,        // the pool contract to swap through
    bool tokenAIn,               // true = tokenA is input
    uint256 amountIn,            // exact input amount
    uint256 amountOutMinimum     // minimum output (slippage protection)
) public payable returns (uint256 amountOut);
```

#### exactInputMultiHop

```solidity
function exactInputMultiHop(
    address recipient,
    bytes memory path,           // encoded path of pools and token directions
    uint256 amountIn,
    uint256 amountOutMinimum
) external payable returns (uint256 amountOut);
```

---

## 7. Carbon (Bancor)

**CarbonController Address:** `0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1`

#### Structs

```solidity
struct TradeAction {
    uint256 strategyId;  // ID of the strategy to trade against
    uint128 amount;      // source amount or target amount depending on the function
}
```

#### tradeBySourceAmount

```solidity
function tradeBySourceAmount(
    Token sourceToken,                       // token to sell (address type alias)
    Token targetToken,                       // token to buy
    TradeAction[] calldata tradeActions,     // strategies to trade against, each with strategyId and source amount
    uint256 deadline,                        // unix timestamp deadline
    uint128 minReturn                        // minimum targetToken to receive (slippage protection)
) external payable returns (uint128);
```

#### tradeByTargetAmount

```solidity
function tradeByTargetAmount(
    Token sourceToken,
    Token targetToken,
    TradeAction[] calldata tradeActions,     // strategies with strategyId and target amount
    uint256 deadline,
    uint128 maxInput                         // maximum sourceToken willing to spend (slippage protection)
) external payable returns (uint128);
```

---

## 8. Fraxswap

**FraxswapRouter V2 Address:** `0xC14d550632db8592D1243Edc8B95b0Ad06703867`

Fraxswap uses a Uniswap V2-compatible router interface. The pairs internally support TWAMM (Time-Weighted Average Market Maker) long-term orders, but the router swap interface is identical to Uniswap V2.

```solidity
function swapExactTokensForTokens(
    uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline
) external returns (uint[] memory amounts);

function swapTokensForExactTokens(
    uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline
) external returns (uint[] memory amounts);

function swapExactETHForTokens(
    uint amountOutMin, address[] calldata path, address to, uint deadline
) external payable returns (uint[] memory amounts);

function swapTokensForExactETH(
    uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline
) external returns (uint[] memory amounts);

function swapExactTokensForETH(
    uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline
) external returns (uint[] memory amounts);

function swapETHForExactTokens(
    uint amountOut, address[] calldata path, address to, uint deadline
) external payable returns (uint[] memory amounts);
```

Also supports fee-on-transfer variants (same as Uniswap V2).

---

## 9. Clipper

**ClipperExchangeInterface Address:** `0x655eDCE464CC797526600a462A8154650EEe4B77`

Clipper uses off-chain signed quotes via its API. Input tokens must be transferred to the exchange contract before calling `sellTokenForToken` or `sellTokenForEth`.

#### sellTokenForToken

```solidity
function sellTokenForToken(
    address inputToken,          // token being sold
    address outputToken,         // token being bought
    address recipient,           // address to receive output tokens
    uint256 minBuyAmount,        // minimum output (slippage protection)
    bytes calldata auxiliaryData // server-signed price data from Clipper API
) external returns (uint256 boughtAmount);
```

#### sellEthForToken

```solidity
function sellEthForToken(
    address outputToken,
    address recipient,
    uint256 minBuyAmount,
    bytes calldata auxiliaryData
) external payable returns (uint256 boughtAmount);
// msg.value is the ETH input
```

#### sellTokenForEth

```solidity
function sellTokenForEth(
    address inputToken,
    address payable recipient,
    uint256 minBuyAmount,
    bytes calldata auxiliaryData
) external returns (uint256 boughtAmount);
```

---

## 10. Integral

**TwapDelay Address:** `0x782534550e2553A42CDFf8D5a94066d8c7B6729B`

Integral SIZE executes orders at the 30-minute TWAP price from a Uniswap V2 oracle. Orders are placed now and executed later (delayed execution).

#### Structs

```solidity
struct SellParams {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;         // exact input amount
    uint256 amountOutMin;     // minimum output (slippage protection)
    bool wrapUnwrap;          // if true, wraps/unwraps ETH ↔ WETH
    address to;               // recipient
    uint256 gasLimit;         // gas limit for delayed execution tx
    uint32 submitDeadline;    // deadline for order submission
}

struct BuyParams {
    address tokenIn;
    address tokenOut;
    uint256 amountInMax;      // maximum input willing to spend
    uint256 amountOut;        // exact output desired
    bool wrapUnwrap;
    address to;
    uint256 gasLimit;
    uint32 submitDeadline;
}
```

#### sell

```solidity
function sell(Orders.SellParams calldata sellParams) external payable returns (uint256 orderId);
```

#### buy

```solidity
function buy(Orders.BuyParams calldata buyParams) external payable returns (uint256 orderId);
```

#### relayerSell

```solidity
function relayerSell(Orders.SellParams calldata sellParams) external payable returns (uint256 orderId);
```

Same as `sell` but callable by a relayer on behalf of the user.

---

## 11. Fluid DEX (Instadapp)

Fluid DEX (formerly Instadapp Fluid) is a "DEX-on-lending" protocol where swap liquidity comes from both **Smart Collateral** (supplied assets) and **Smart Debt** (borrowed assets) on top of the Fluid Liquidity Layer. This architecture generates significantly more trading liquidity per dollar of TVL than traditional DEXes.

**Key mechanics:**
- Uses `x * y = k` constant product formula with **imaginary reserves** (virtual liquidity amplification)
- Each pool has two liquidity sources: **collateral reserves** (from suppliers) and **debt reserves** (from borrowers)
- Swaps cost approximately 90k-145k gas
- Supports both exact-input (`swapIn`) and exact-output (`swapOut`) swaps
- Optional callback pattern saves ~5k-20k gas by letting the caller handle token transfers
- Native ETH is supported via `payable` functions (send ETH as `msg.value`)

**Architecture:** Fluid has two DEX systems on Ethereum mainnet:
1. **DEX T1** -- individual pool contracts deployed by the DexFactory (one contract per token pair)
2. **DEX Lite** -- a singleton contract handling multiple pools, identified by `DexKey` structs

### Core Contract Addresses (Ethereum Mainnet)

| Contract | Address | Description |
|----------|---------|-------------|
| Liquidity Layer | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | Core liquidity singleton |
| DexFactory | `0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085` | Deploys DEX T1 pool contracts |
| DexResolver | `0x11D80CfF056Cef4F9E6d23da8672fE9873e5cC07` | Read-only resolver for T1 pool data |
| DexReservesResolver | `0x05Bd8269A20C472b148246De20E6852091BF16Ff` | Reserves/pricing data for T1 pools |
| FluidDexLite | `0xBbcb91440523216e2b87052A99F69c604A7b6e00` | DEX Lite singleton contract |
| FluidDexLiteResolver | `0x12a47cEB96A952E8D4A6eA9FE3b40b79bbaeb4e9` | Read-only resolver for Lite pools |
| Deployer Factory | `0x4EC7b668BAF70d4A4b0FC7941a7708A07b6d45Be` | Protocol deployer factory |

### Example DEX T1 Pool Addresses (Ethereum Mainnet)

| Pool | Address |
|------|---------|
| Dex wstETH-ETH | `0x0B1a513ee24972DAEf112bC777a5610d4325C9e7` |
| Dex USDC-ETH | `0x836951EB21F3Df98273517B7249dCEFF270d34bf` |

Pool addresses are deterministically computed from the DexFactory. Call `DexFactory.totalDexes()` for the count and `DexFactory.getDexAddress(uint256 dexId_)` to look up individual pool addresses.

---

### Fluid DEX T1 Pool Swaps

Each DEX T1 pool is a separate contract implementing `IFluidDexT1`. Swaps are called directly on the pool contract.

#### Callback Interface

```solidity
interface IDexCallback {
    function dexCallback(address token_, uint256 amount_) external;
}
```

When using `swapInWithCallback` or `swapOutWithCallback`, the pool sends output tokens first, then calls `dexCallback` on `msg.sender`. The callback must transfer `amount_` of `token_` to the pool contract.

#### Structs

```solidity
struct ConstantViews {
    uint256 dexId;
    address liquidity;
    address factory;
    Implementations implementations;
    address deployerContract;
    address token0;
    address token1;
    bytes32 supplyToken0Slot;
    bytes32 borrowToken0Slot;
    bytes32 supplyToken1Slot;
    bytes32 borrowToken1Slot;
    bytes32 exchangePriceToken0Slot;
    bytes32 exchangePriceToken1Slot;
    uint256 oracleMapping;
}

struct ConstantViews2 {
    uint token0NumeratorPrecision;
    uint token0DenominatorPrecision;
    uint token1NumeratorPrecision;
    uint token1DenominatorPrecision;
}

struct PricesAndExchangePrice {
    uint lastStoredPrice;           // 1e27 decimals
    uint centerPrice;               // 1e27 decimals
    uint upperRange;                // 1e27 decimals
    uint lowerRange;                // 1e27 decimals
    uint geometricMean;             // geometric mean of upper & lower range, 1e27
    uint supplyToken0ExchangePrice;
    uint borrowToken0ExchangePrice;
    uint supplyToken1ExchangePrice;
    uint borrowToken1ExchangePrice;
}

struct CollateralReserves {
    uint token0RealReserves;
    uint token1RealReserves;
    uint token0ImaginaryReserves;   // virtual reserves for liquidity amplification
    uint token1ImaginaryReserves;
}

struct DebtReserves {
    uint token0Debt;
    uint token1Debt;
    uint token0RealReserves;
    uint token1RealReserves;
    uint token0ImaginaryReserves;
    uint token1ImaginaryReserves;
}

struct Oracle {
    uint twap1by0;
    uint lowestPrice1by0;
    uint highestPrice1by0;
    uint twap0by1;
    uint lowestPrice0by1;
    uint highestPrice0by1;
}
```

#### swapIn

Swap with an exact input amount. Tokens must be transferred to the pool (or sent as ETH) before calling.

```solidity
function swapIn(
    bool swap0to1_,     // true = sell token0 for token1; false = sell token1 for token0
    uint256 amountIn_,  // exact amount of input token to swap
    uint256 amountOutMin_, // minimum output amount (slippage protection; reverts if not met)
    address to_         // recipient address for output tokens
) external payable returns (uint256 amountOut_);
```

#### swapInWithCallback

Same as `swapIn`, but uses the callback pattern. The pool sends output tokens first, then calls `IDexCallback.dexCallback(token_, amount_)` on `msg.sender` to pull input tokens.

```solidity
function swapInWithCallback(
    bool swap0to1_,     // true = sell token0 for token1; false = sell token1 for token0
    uint256 amountIn_,  // exact amount of input token to swap
    uint256 amountOutMin_, // minimum output amount (slippage protection)
    address to_         // recipient address for output tokens
) external payable returns (uint256 amountOut_);
```

#### swapOut

Swap with an exact output amount. Caller specifies desired output; excess input is not refunded.

```solidity
function swapOut(
    bool swap0to1_,     // true = sell token0 for token1; false = sell token1 for token0
    uint256 amountOut_, // exact amount of output token desired
    uint256 amountInMax_, // maximum input amount willing to spend (slippage protection)
    address to_         // recipient address for output tokens
) external payable returns (uint256 amountIn_);
```

#### swapOutWithCallback

Same as `swapOut` but with callback pattern for gas savings.

```solidity
function swapOutWithCallback(
    bool swap0to1_,     // true = sell token0 for token1; false = sell token1 for token0
    uint256 amountOut_, // exact amount of output token desired
    uint256 amountInMax_, // maximum input amount willing to spend (slippage protection)
    address to_         // recipient address for output tokens
) external payable returns (uint256 amountIn_);
```

#### View Functions

```solidity
function DEX_ID() external view returns (uint256);

function constantsView() external view returns (ConstantViews memory);
function constantsView2() external view returns (ConstantViews2 memory);

function getPricesAndExchangePrices() external;

function getCollateralReserves(
    uint geometricMean_,
    uint upperRange_,
    uint lowerRange_,
    uint token0SupplyExchangePrice_,
    uint token1SupplyExchangePrice_
) external view returns (CollateralReserves memory c_);

function getDebtReserves(
    uint geometricMean_,
    uint upperRange_,
    uint lowerRange_,
    uint token0BorrowExchangePrice_,
    uint token1BorrowExchangePrice_
) external view returns (DebtReserves memory d_);

function oraclePrice(
    uint[] memory secondsAgos_
) external view returns (Oracle[] memory twaps_, uint currentPrice_);
```

#### Events

```solidity
event Swap(bool swap0to1_, uint256 amountIn_, uint256 amountOut_, address to_);
```

---

### Fluid DEX Lite (Singleton)

DEX Lite is a singleton contract (`0xBbcb91440523216e2b87052A99F69c604A7b6e00`) that manages multiple pools, each identified by a `DexKey`. It supports both single-hop and multi-hop swaps.

#### Structs

```solidity
struct DexKey {
    address token0;     // lexicographically smaller token address
    address token1;     // lexicographically larger token address
    bytes32 salt;       // unique identifier for the pool within this token pair
}
```

#### swapSingle

Execute a single-hop swap on one pool.

```solidity
function swapSingle(
    DexKey calldata dexKey,   // identifies the pool (token0, token1, salt)
    bool swap0To1,            // true = sell token0 for token1; false = opposite
    int256 amountSpecified,   // positive = exact input amount; negative = exact output amount
    uint256 amountLimit,      // if amountSpecified > 0: minimum output; if < 0: maximum input
    address receiver          // recipient of output tokens
) external payable returns (int256 amount0, int256 amount1);
```

#### swapMultiHop

Execute a multi-hop swap across multiple pools in sequence.

```solidity
function swapMultiHop(
    address[] calldata path,      // ordered token addresses in the swap route
    DexKey[] calldata dexKeys,    // pool keys for each hop (length = path.length - 1)
    int256 amountSpecified,       // positive = exact input; negative = exact output
    uint256 amountLimit,          // slippage protection limit
    address receiver              // recipient of final output tokens
) external payable returns (int256 totalAmount0, int256 totalAmount1);
```

#### Callback Interface (DEX Lite)

```solidity
interface IDexLiteCallback {
    function dexCallback(address token, uint256 amount, bytes calldata data) external;
}
```

#### Resolver Functions (FluidDexLiteResolver)

```solidity
function getAllDexes() external view returns (DexKey[] memory);

function estimateSwapSingle(
    DexKey calldata dexKey,
    bool swap0To1,
    int256 amountSpecified       // positive = exact input; negative = exact output
) external returns (uint256);

function estimateSwapHop(
    address[] calldata path,
    DexKey[] calldata dexKeys,
    int256 amountSpecified
) external returns (uint256);

function getDexState(DexKey memory dexKey) external view returns (DexState memory);
function getPricesAndReserves(DexKey memory dexKey) external returns (Prices memory, Reserves memory);
function getDexEntireData(DexKey memory dexKey) external returns (DexEntireData memory);
function getAllDexesEntireData() external returns (DexEntireData[] memory);
```

#### DEX Lite Resolver Structs

```solidity
struct DexVariables {
    uint256 fee;
    uint256 revenueCut;
    uint256 rebalancingStatus;
    bool isCenterPriceShiftActive;
    uint256 centerPrice;
    address centerPriceAddress;
    bool isRangePercentShiftActive;
    uint256 upperRangePercent;
    uint256 lowerRangePercent;
    bool isThresholdPercentShiftActive;
    uint256 upperShiftThresholdPercent;
    uint256 lowerShiftThresholdPercent;
    uint256 token0Decimals;
    uint256 token1Decimals;
    uint256 totalToken0AdjustedAmount;
    uint256 totalToken1AdjustedAmount;
}

struct Prices {
    uint256 poolPrice;
    uint256 centerPrice;
    uint256 upperRangePrice;
    uint256 lowerRangePrice;
    uint256 upperThresholdPrice;
    uint256 lowerThresholdPrice;
}

struct Reserves {
    uint256 token0RealReserves;
    uint256 token1RealReserves;
    uint256 token0ImaginaryReserves;
    uint256 token1ImaginaryReserves;
}
```

#### Integration Notes

- **Pool discovery:** Call `FluidDexLiteResolver.getAllDexes()` to enumerate available pools.
- **Price estimation:** Use `estimateSwapSingle()` / `estimateSwapHop()` (gas-free static calls) to get expected output amounts before executing.
- **Token ordering:** `token0` must be lexicographically smaller than `token1` in `DexKey`.
- **amountSpecified sign convention:** Positive values mean exact input (you specify how much to sell); negative values mean exact output (you specify how much to buy).
- **Swap pausing:** Pools can be paused via governance. Monitor `LogPauseSwapAndArbitrage()` and `LogUnpauseSwapAndArbitrage()` events, or check `isSwapAndArbitragePaused` in `DexState`.
- **Liquidity limits:** Maximum swap size is constrained by `limits.withdrawable.available + limits.borrowable.available` from the resolver.
- **Reserves are scaled to 1e12 decimals** in the resolver output for uniformity.
