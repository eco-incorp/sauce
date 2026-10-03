// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title MockV2Pair
/// @notice A Uniswap V2 pair's `getReserves` and `swap`, with V2's own checks: it pays what is asked,
///         then requires the 0.3%-fee constant product of what it holds to hold, and books its whole
///         balance as its reserves — so a swap that underpays, or asks too much, reverts.
/// @dev `sync` books the balances it was funded with.
contract MockV2Pair {
    address public immutable token0;
    address public immutable token1;
    uint112 private reserve0;
    uint112 private reserve1;

    constructor(address a, address b) {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function sync() public {
        reserve0 = uint112(IERC20Balance(token0).balanceOf(address(this)));
        reserve1 = uint112(IERC20Balance(token1).balanceOf(address(this)));
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, 0);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        require(amount0Out > 0 || amount1Out > 0, "UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT");
        require(amount0Out < reserve0 && amount1Out < reserve1, "UniswapV2: INSUFFICIENT_LIQUIDITY");
        if (amount0Out > 0) IERC20Balance(token0).transfer(to, amount0Out);
        if (amount1Out > 0) IERC20Balance(token1).transfer(to, amount1Out);
        uint256 balance0 = IERC20Balance(token0).balanceOf(address(this));
        uint256 balance1 = IERC20Balance(token1).balanceOf(address(this));
        uint256 in0 = balance0 > reserve0 - amount0Out ? balance0 - (reserve0 - amount0Out) : 0;
        uint256 in1 = balance1 > reserve1 - amount1Out ? balance1 - (reserve1 - amount1Out) : 0;
        require(in0 > 0 || in1 > 0, "UniswapV2: INSUFFICIENT_INPUT_AMOUNT");
        uint256 adjusted0 = balance0 * 1000 - in0 * 3;
        uint256 adjusted1 = balance1 * 1000 - in1 * 3;
        require(
            adjusted0 * adjusted1 >= uint256(reserve0) * uint256(reserve1) * 1000 ** 2,
            "UniswapV2: K"
        );
        sync();
    }
}
