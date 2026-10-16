// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// A contract wallet that runs a batch of calls from its own address for its owner, all of them or
/// none: what a smart wallet does with an EIP-5792 `wallet_sendCalls` batch, such as the one
/// Coinbase's Wallet MCP `send_calls` sends. Its entry point has Coinbase Smart Wallet's shape,
/// `executeBatch((address target, uint256 value, bytes data)[])`, and reverts with the failing
/// call's own revert data; the ERC-4337 entry point and the signers are left out, the owner calling
/// directly. A stand-in for a smart wallet that owns a Pot: every call it makes has this contract as
/// `msg.sender`.
///
/// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `BatchWallet.json` beside this
/// file.
contract BatchWallet {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    error NotOwner();

    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    receive() external payable {}

    function executeBatch(Call[] calldata calls) external payable {
        if (msg.sender != owner) revert NotOwner();
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory result) = calls[i].target.call{value: calls[i].value}(
                calls[i].data
            );
            if (!ok) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
        }
    }
}
