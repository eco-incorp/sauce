// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BalanceDelta, Currency, PoolKey, SwapParams, IUnlockCallback } from "../../src/interfaces/IUniswapV4.sol";

/// @title MockPoolManager
/// @notice The slice of Uniswap V4's PoolManager the Router's V4 path drives — `unlock`, `swap`,
///         `take`, `sync`, `settle` — over one fixed-rate pool.
/// @dev V4's sign convention, strictly: a NEGATIVE `amountSpecified` is exact input, and anything
///      else is refused, so a swap that reaches this with the wrong sign reverts rather than
///      silently trading an exact output. `lastAmountSpecified` records what the Router passed.
///      `settle` credits nothing and checks nothing: the test reads balances instead.
contract MockPoolManager {
    uint256 public immutable rate; // currency1 per currency0, scaled by 1e18
    int256 public lastAmountSpecified;

    constructor(uint256 _rate) {
        rate = _rate;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory, SwapParams memory params, bytes calldata) external returns (BalanceDelta) {
        lastAmountSpecified = params.amountSpecified;
        require(params.amountSpecified < 0, "MockPoolManager: exact input only (negative amountSpecified)");
        uint256 amountIn = uint256(-params.amountSpecified);
        int128 owed = -int128(int256(amountIn));
        int128 paid = params.zeroForOne
            ? int128(int256((amountIn * rate) / 1e18))
            : int128(int256((amountIn * 1e18) / rate));
        (int128 amount0, int128 amount1) = params.zeroForOne ? (owed, paid) : (paid, owed);
        return BalanceDelta.wrap((int256(amount0) << 128) | int256(uint256(uint128(amount1))));
    }

    function take(Currency currency, address to, uint256 amount) external {
        IERC20(Currency.unwrap(currency)).transfer(to, amount);
    }

    function sync(Currency) external { }

    function settle() external payable returns (uint256) {
        return 0;
    }
}
