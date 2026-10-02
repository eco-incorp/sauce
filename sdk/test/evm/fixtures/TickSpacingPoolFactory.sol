// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice A test stand-in for an Aerodrome Slipstream CLFactory's pool lookup: `getPool(tokenA,
/// tokenB, tickSpacing)`, Slipstream's own signature, answering with whatever pool a test set.
/// Slipstream's factory needs its voter, registry and pool implementation, none of which a local
/// chain has; the lookup is all a program asks of it.
contract TickSpacingPoolFactory {
    mapping(address => mapping(address => mapping(int24 => address))) public getPool;

    function setPool(address tokenA, address tokenB, int24 tickSpacing, address pool) external {
        getPool[tokenA][tokenB][tickSpacing] = pool;
        getPool[tokenB][tokenA][tickSpacing] = pool;
    }
}
