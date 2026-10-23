// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// A contract wallet like `Wallet1271`, whose `isValidSignature` answers `answer` VERBATIM, as raw
/// return data, when `signature` is `signer`'s 65-byte `r ‖ s ‖ v` over `hash`, and `0xffffffff`
/// otherwise. It pins what the Pot reads of an ERC-1271 answer: at least 32 bytes, the first word the
/// magic value with its other 28 bytes zero, and anything after that word ignored. One deployed with
/// the magic word followed by more bytes is accepted; one with the selector and non-zero padding is
/// refused.
///
/// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `Wallet1271Raw.json` beside
/// this file.
contract Wallet1271Raw {
    address public immutable signer;
    bytes private answer;

    constructor(address signer_, bytes memory answer_) {
        signer = signer_;
        answer = answer_;
    }

    receive() external payable {}

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length != 65) return 0xffffffff;
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        address recovered = ecrecover(hash, v, r, s);
        if (recovered == address(0) || recovered != signer) return 0xffffffff;
        bytes memory raw = answer;
        assembly {
            return(add(raw, 0x20), mload(raw))
        }
    }
}
