// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
 * @notice Mock Uniswap V3 pool for unit testing the Router's swap logic
 * @dev Follows the real pool's order:
 *      1. Compute the amounts (a constant rate; `depth` caps the fill when a price limit is set)
 *      2. Transfer the output to the recipient
 *      3. Call the swap callback on msg.sender, with `data` as given
 *      4. Require the input lane to have arrived, as Uniswap V3's `IIA` check does
 */
contract MockV3Pool {
    using SafeERC20 for IERC20;

    uint160 internal constant MIN_SQRT_RATIO = 4_295_128_739;
    uint160 internal constant MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    // Mock exchange rate: token1 per token0 (scaled by 1e18)
    uint256 public exchangeRate;
    uint128 public poolLiquidity = 1e18;

    // slot0 mock
    uint160 public sqrtPriceX96 = 1e18; // arbitrary nonzero

    bool public usePancakeCallback;

    /// @dev A V3 fork that re-enters under its own callback name (Synthra, UnitFlow, Algebra).
    ///      Nonzero overrides both named callbacks above: the pool calls this selector with the
    ///      standard `(int256,int256,bytes)` arguments and bubbles its revert, as a real fork does.
    bytes4 public callbackSelector;

    /// @dev The most input an exact-input swap fills when the caller set a price limit (anything but
    ///      the boundary one step inside the sqrt-price range): the input at which the price reaches
    ///      that limit. 0 means the limit is never reached. A limited fill asks for less and sends
    ///      proportionally less, as a real pool does.
    uint256 public depth;

    /// @dev Malicious-pool knobs, all off by default (an honest pool). `extraCallbacks` re-enters
    ///      the callback that many more times after the first, with the same deltas.
    ///      `inputAdjustment` is added to the input lane the pool asks to be paid, and returns:
    ///      positive inflates it past the exact input, negative is a partial fill.
    ///      `skipCallback` hands out the output and never calls back. `outputLaneAsk` makes the pool
    ///      ask to be paid that much on the OUTPUT lane too. `tamperedData` replaces the callback data
    ///      the pool hands back. A dishonest pool skips the payment check.
    /// @dev A plugin that spends the gas it is given, like Base QuickSwap V4 / Hydrex V4's arbitrage plugins: after
    ///      the swap, when at least `elasticThreshold` gas is left, it runs an "arbitrage" that never finishes under
    ///      a gas limit of min(`elasticCap`, what is left), catching its failure. 0 is no plugin.
    uint256 public elasticThreshold;
    uint256 public elasticCap;
    uint8 public extraCallbacks;
    int256 public inputAdjustment;
    bool public skipCallback;
    int256 public outputLaneAsk;
    bool public tamper;
    bytes public tamperedData;

    /// @dev Return `(0, 0)` from `swap` after the callback has been paid in full: the pool takes the
    ///      input and reports it took none, so a Router that trusts the return value under-reports
    ///      what left the Pot.
    bool public underreportReturn;

    /// @dev Off by default so a gas measurement pays for no bookkeeping: record each swap's
    ///      arguments for a test to read back.
    bool public recording;
    int256 public lastAmountSpecified;
    uint160 public lastSqrtPriceLimitX96;
    address public lastRecipient;
    bytes public lastData;

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

    function setDepth(
        uint256 _depth
    ) external {
        depth = _depth;
    }

    function setElasticPlugin(
        uint256 threshold,
        uint256 cap
    ) external {
        elasticThreshold = threshold;
        elasticCap = cap;
    }

    /// @dev The elastic plugin's arbitrage: it spends every unit of gas it is handed.
    function burnArbitrage() external view {
        require(msg.sender == address(this), "self");
        assembly {
            for { } 1 { } { }
        }
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

    function setOutputLaneAsk(
        int256 _ask
    ) external {
        outputLaneAsk = _ask;
    }

    function setUnderreportReturn(
        bool _under
    ) external {
        underreportReturn = _under;
    }

    function setTamperedData(
        bytes calldata _data
    ) external {
        tamper = true;
        tamperedData = _data;
    }

    function setRecording(
        bool _recording
    ) external {
        recording = _recording;
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
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1) {
        require(amountSpecified != 0, "AS");
        if (recording) {
            lastAmountSpecified = amountSpecified;
            lastSqrtPriceLimitX96 = sqrtPriceLimitX96;
            lastRecipient = recipient;
            lastData = data;
        }

        bool exactInput = amountSpecified > 0;
        bool limited = sqrtPriceLimitX96 != (zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1);
        uint256 amountIn;
        uint256 amountOut;
        if (exactInput) {
            amountIn = uint256(amountSpecified);
            if (limited && depth != 0 && amountIn > depth) {
                amountIn = depth;
            }
            amountOut = zeroForOne ? (amountIn * exchangeRate) / 1e18 : (amountIn * 1e18) / exchangeRate;
        } else {
            amountOut = uint256(-amountSpecified);
            amountIn = zeroForOne ? (amountOut * 1e18) / exchangeRate + 1 : (amountOut * exchangeRate) / 1e18 + 1;
        }

        int256 inputLane = int256(amountIn) + inputAdjustment;
        int256 outputLane = -int256(amountOut) + outputLaneAsk;
        (amount0, amount1) = zeroForOne ? (inputLane, outputLane) : (outputLane, inputLane);
        (address tokenIn, address tokenOut) = zeroForOne ? (token0, token1) : (token1, token0);

        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));
        bytes memory handedBack = data;
        if (tamper) {
            handedBack = tamperedData;
        }
        _callback(amount0, amount1, handedBack);

        bool honest = extraCallbacks == 0 && inputAdjustment <= 0 && outputLaneAsk == 0 && !skipCallback;
        if (honest && inputLane > 0) {
            require(IERC20(tokenIn).balanceOf(address(this)) >= balanceBefore + uint256(inputLane), "IIA");
        }

        emit Swap(msg.sender, recipient, amount0, amount1, sqrtPriceX96, poolLiquidity, 0);

        if (elasticThreshold != 0 && gasleft() >= elasticThreshold) {
            try this.burnArbitrage{ gas: elasticCap }() { } catch { }
        }

        if (underreportReturn) {
            (amount0, amount1) = (int256(0), int256(0));
        }
    }

    function _callback(
        int256 amount0,
        int256 amount1,
        bytes memory data
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
        bytes memory data
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
