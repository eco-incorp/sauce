// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice A working, mintable ERC20 whose three writes take effect and then return EXACTLY the
/// bytes it was constructed with — not ABI-encoded, not length-prefixed. That makes the returndata
/// the one variable: a word of 2, a single `0x01`, 31 bytes that read as 1 once zero-padded, or 64
/// bytes whose first word is 1. `SafeERC20` refuses the first three and accepts the last, so a check
/// that disagrees on any of them is not the check it claims to be.
///
/// The reads are ordinary public getters, so what a write returns is the only thing that varies.
/// Beside `FalseReturnERC20` (a `false`) and `NoReturnERC20` (nothing at all, which IS legitimate
/// when the callee has code), this covers the remaining ways an ERC-20 can answer a write.
contract OddReturnERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bytes private writeReturn;

    constructor(bytes memory writeReturn_) {
        writeReturn = writeReturn_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        _move(msg.sender, to, amount);
        _answer();
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        _answer();
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
        _answer();
    }

    function _move(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    /// @dev Ends the call, returning `writeReturn`'s raw bytes.
    function _answer() private view {
        bytes memory data = writeReturn;
        assembly {
            return(add(data, 0x20), mload(data))
        }
    }
}
