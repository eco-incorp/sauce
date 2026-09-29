// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal callback interface matching Uniswap V3
interface ISwapCallback {
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external;
}

/// @dev Minimal callback interface matching PancakeSwap V3
interface IPancakeCallback {
    function pancakeV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external;
}

/**
 * @title MockV3Pool
 * @notice Mock Uniswap V3 pool for unit testing SauceRouter swap logic
 * @dev Implements the same swap + callback pattern as real V3 pools:
 *      1. Compute output amounts
 *      2. Transfer output tokens to recipient
 *      3. Call uniswapV3SwapCallback on msg.sender
 *      4. Verify input tokens were received
 */
contract MockV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    // Mock exchange rate: token0 per token1 (scaled by 1e18)
    // e.g., for ETH/USDC: 1 ETH = 3000 USDC → rate = 3000e6 (USDC decimals)
    uint256 public exchangeRate;
    uint128 public poolLiquidity = 1e18;

    // slot0 mock
    uint160 public sqrtPriceX96 = 1e18; // arbitrary nonzero

    bool public usePancakeCallback;

    /// @dev A V3 fork that re-enters under its own callback name (Synthra, UnitFlow). Nonzero
    ///      overrides both named callbacks above: the pool calls this selector with the standard
    ///      `(int256,int256,bytes)` arguments and bubbles its revert, as a real fork does.
    bytes4 public callbackSelector;

    /// @dev Malicious-pool knobs, all off by default (an honest pool). `extraCallbacks` re-enters
    ///      the callback that many more times after the first, with the same deltas.
    ///      `inputAdjustment` is added to the input lane the pool asks to be paid, and returns:
    ///      positive inflates it past the exact input, negative is a partial fill.
    ///      `skipCallback` hands out the output and never calls back.
    uint8 public extraCallbacks;
    int256 public inputAdjustment;
    bool public skipCallback;

    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96After,
        uint128 liquidity,
        int24 tick
    );

    constructor(
        address _token0,
        address _token1,
        uint24 _fee,
        uint256 _exchangeRate
    ) {
        require(_token0 < _token1, "MockV3Pool: token0 must be < token1");
        token0 = _token0;
        token1 = _token1;
        fee = _fee;
        exchangeRate = _exchangeRate;
    }

    function setExchangeRate(
        uint256 _rate
    ) external {
        exchangeRate = _rate;
    }

    function setSqrtPriceX96(
        uint160 _price
    ) external {
        sqrtPriceX96 = _price;
    }

    function setUsePancakeCallback(
        bool _use
    ) external {
        usePancakeCallback = _use;
    }

    function setCallbackSelector(
        bytes4 _selector
    ) external {
        callbackSelector = _selector;
    }

    function setExtraCallbacks(
        uint8 _count
    ) external {
        extraCallbacks = _count;
    }

    function setInputAdjustment(
        int256 _adjustment
    ) external {
        inputAdjustment = _adjustment;
    }

    function setSkipCallback(
        bool _skip
    ) external {
        skipCallback = _skip;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }

    /// @dev Settable, because a test that weights by liquidity cannot observe its own weighting while
    ///      every pool reports the same number. Defaults to 1e18, what this used to return.
    function liquidity() external view returns (uint128) {
        return poolLiquidity;
    }

    function setLiquidity(
        uint128 _liquidity
    ) external {
        poolLiquidity = _liquidity;
    }

    /**
     * @notice Mock V3 swap following the exact Uniswap V3 pattern:
     *   - Positive amountSpecified = exact input
     *   - Negative amountSpecified = exact output
     * @param recipient Where output tokens go
     * @param zeroForOne Direction: true = token0→token1, false = token1→token0
     * @param amountSpecified Positive = exact input, negative = exact output
     */
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160, /* sqrtPriceLimitX96 */
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1) {
        bool exactInput = amountSpecified > 0;

        if (zeroForOne) {
            // token0 → token1
            if (exactInput) {
                uint256 amountIn = uint256(amountSpecified);
                uint256 amountOut = (amountIn * exchangeRate) / 1e18;
                amount0 = int256(amountIn); // positive: caller owes token0
                amount1 = -int256(amountOut); // negative: pool owes token1
            } else {
                uint256 amountOut = uint256(-amountSpecified);
                uint256 amountIn = (amountOut * 1e18) / exchangeRate + 1; // round up
                amount0 = int256(amountIn);
                amount1 = -int256(amountOut);
            }
            amount0 += inputAdjustment;

            // Step 1: Transfer output tokens to recipient
            IERC20(token1).transfer(recipient, uint256(-amount1));

            // Step 2: Callback — ask caller to pay input tokens
            _callback(amount0, amount1, data);

            // Step 3: Verify we received the input tokens
            // (real pool checks balance delta, we just trust the callback)
        } else {
            // token1 → token0
            if (exactInput) {
                uint256 amountIn = uint256(amountSpecified);
                uint256 amountOut = (amountIn * 1e18) / exchangeRate;
                amount0 = -int256(amountOut); // negative: pool owes token0
                amount1 = int256(amountIn); // positive: caller owes token1
            } else {
                uint256 amountOut = uint256(-amountSpecified);
                uint256 amountIn = (amountOut * exchangeRate) / 1e18 + 1;
                amount0 = -int256(amountOut);
                amount1 = int256(amountIn);
            }
            amount1 += inputAdjustment;

            // Transfer output tokens to recipient
            IERC20(token0).transfer(recipient, uint256(-amount0));

            // Callback
            _callback(amount0, amount1, data);
        }

        emit Swap(msg.sender, recipient, amount0, amount1, sqrtPriceX96, poolLiquidity, 0);
    }

    function _callback(
        int256 amount0,
        int256 amount1,
        bytes calldata data
    ) internal {
        if (skipCallback) {
            return;
        }
        for (uint256 i = 0; i <= extraCallbacks; ++i) {
            _callbackOnce(amount0, amount1, data);
        }
    }

    function _callbackOnce(
        int256 amount0,
        int256 amount1,
        bytes calldata data
    ) internal {
        if (callbackSelector != bytes4(0)) {
            (bool ok, bytes memory ret) =
                msg.sender.call(abi.encodeWithSelector(callbackSelector, amount0, amount1, data));
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        } else if (usePancakeCallback) {
            IPancakeCallback(msg.sender).pancakeV3SwapCallback(amount0, amount1, data);
        } else {
            ISwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        }
    }
}
