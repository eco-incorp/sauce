// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256 amount0, uint256 amount1);
}

/// @notice Adds liquidity to a real Uniswap V3 pool for a test: `pool.mint` calls back
/// `uniswapV3MintCallback` on its caller, which pays the pool from the account that asked, out of
/// that account's allowance to this contract.
contract UniswapV3Minter {
    function mint(address pool, int24 tickLower, int24 tickUpper, uint128 liquidity) external {
        IUniswapV3Pool(pool).mint(msg.sender, tickLower, tickUpper, liquidity, abi.encode(msg.sender));
    }

    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata data) external {
        address payer = abi.decode(data, (address));
        if (amount0 > 0) IERC20(IUniswapV3Pool(msg.sender).token0()).transferFrom(payer, msg.sender, amount0);
        if (amount1 > 0) IERC20(IUniswapV3Pool(msg.sender).token1()).transferFrom(payer, msg.sender, amount1);
    }
}
