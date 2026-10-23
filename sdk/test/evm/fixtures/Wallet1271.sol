// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// A contract wallet that owns a Pot and signs through ERC-1271, as a Safe or an EIP-7702 account
/// does: `isValidSignature(hash, signature)` answers the magic value when `signature` is `signer`'s
/// 65-byte `r ‖ s ‖ v` over `hash`, and refuses everything else. Unlike the Pot's own ecrecover path
/// it checks neither `s` nor `v` beyond what `ecrecover` does, because that is the wallet's rule.
/// The Pot's `owner()` is this contract, so the key that signed is never the owner the Pot compares.
///
/// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `Wallet1271.json` beside this
/// file.
contract Wallet1271 {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    receive() external payable {}

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length != 65) return 0xffffffff;
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        address recovered = ecrecover(hash, v, r, s);
        if (recovered != address(0) && recovered == signer) return 0x1626ba7e;
        return 0xffffffff;
    }
}
