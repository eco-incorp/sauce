// SPDX-License-Identifier: MIT
// Rebuild from the repository root:
// /opt/homebrew/bin/solc --combined-json abi,bin --optimize --evm-version cancun sdk/test/evm/fixtures/MockMaverickPool.sol
// Save contracts["sdk/test/evm/fixtures/MockMaverickPool.sol:MockMaverickPool"] as
// MockMaverickPool.json: { "abi": abi, "creationCode": "0x" + bin }.
pragma solidity ^0.8.19;

interface IMaverickToken {
    function balanceOf(address holder) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IMaverickCallback {
    function maverickV2SwapCallback(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata data
    ) external;
}

/// @dev Fixed-rate, exact-input pool with Maverick V2's output-before-callback payment order.
contract MockMaverickPool {
    struct SwapParams {
        uint256 amount;
        bool tokenAIn;
        bool exactOutput;
        int32 tickLimit;
    }

    address public immutable tokenA;
    address public immutable tokenB;
    uint256 public immutable rate; // Output units per input unit, in either direction.

    int32 public lastTickLimit;
    bool public lastTokenAIn;
    uint256 public lastAmount;
    bool public lastExactOutput;
    uint256 public swapCount;

    constructor(address a, address b, uint256 exchangeRate) {
        require(a < b, "MockMaverickPool: tokenA must be < tokenB");
        require(exchangeRate > 0, "MockMaverickPool: zero rate");
        tokenA = a;
        tokenB = b;
        rate = exchangeRate;
    }

    function swap(address recipient, SwapParams calldata params, bytes calldata data)
        external
        returns (uint256 amountIn, uint256 amountOut)
    {
        require(!params.exactOutput, "MockMaverickPool: exact input only");
        lastTickLimit = params.tickLimit;
        lastTokenAIn = params.tokenAIn;
        lastAmount = params.amount;
        lastExactOutput = params.exactOutput;
        ++swapCount;

        address tokenIn = params.tokenAIn ? tokenA : tokenB;
        address tokenOut = params.tokenAIn ? tokenB : tokenA;
        amountIn = params.amount;
        amountOut = amountIn * rate;
        uint256 beforeInput = IMaverickToken(tokenIn).balanceOf(address(this));
        require(IMaverickToken(tokenOut).transfer(recipient, amountOut), "MockMaverickPool: output transfer");
        IMaverickCallback(msg.sender).maverickV2SwapCallback(tokenIn, amountIn, amountOut, data);
        require(
            IMaverickToken(tokenIn).balanceOf(address(this)) == beforeInput + amountIn,
            "MockMaverickPool: unpaid input"
        );
    }
}
