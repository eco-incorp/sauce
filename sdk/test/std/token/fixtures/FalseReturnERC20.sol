// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice A mintable ERC20 whose `transfer` and `approve` RETURN FALSE instead of reverting, and
/// move nothing. Tokens like this exist, and they are the case `SafeERC20` was written for: a caller
/// that ignores the return value believes the transfer happened and the value is quietly gone.
///
/// The counterpart of `NoReturnERC20`, which returns nothing at all. Between them they cover both
/// ways an ERC-20 can lie about a write.
contract FalseReturnERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function approve(address, uint256) external pure returns (bool) {
        return false;
    }
}
