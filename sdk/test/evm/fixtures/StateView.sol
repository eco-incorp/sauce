// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @notice The two reads of Uniswap V4's `StateView` (v4-periphery) a program makes of a pool,
/// `getSlot0` and `getLiquidity`, as `StateView` makes them: `StateLibrary` over the PoolManager's
/// `extsload`. Compiled from this file against the sources of the v4-core npm package.
contract StateView {
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function getSlot0(PoolId poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        return poolManager.getSlot0(poolId);
    }

    function getLiquidity(PoolId poolId) external view returns (uint128 liquidity) {
        return poolManager.getLiquidity(poolId);
    }
}
