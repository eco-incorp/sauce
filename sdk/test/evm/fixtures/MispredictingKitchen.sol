// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// A Kitchen implementation that is the released one in every respect but two. It predicts every
/// Pot at `elsewhere` — `predictPot(owner, salt)`, `predictPot(owner, salt, routerFixed)` and
/// `predictSharedPot(salt)`, whatever the arguments — the way a Kitchen upgraded to another Pot
/// derivation answers an SDK that still predicts the old address; and it reports the Pot init-code
/// hash it is given as `potInitCodeHash()`, which names the release that Kitchen mints Pots of: the
/// released one's, an older release's, or a hash no release records. It forwards every other call to
/// `released` by DELEGATECALL, so behind the Kitchen's proxy it deploys, charges and owns exactly as
/// the release does.
///
/// The test points the Kitchen proxy's EIP-1967 implementation slot at it, and back after.
///
/// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `MispredictingKitchen.json`
/// beside this file.
contract MispredictingKitchen {
    address public immutable released;
    address public immutable elsewhere;
    bytes32 public immutable potInitCodeHash;

    constructor(address released_, address elsewhere_, bytes32 potInitCodeHash_) {
        released = released_;
        elsewhere = elsewhere_;
        potInitCodeHash = potInitCodeHash_;
    }

    function predictPot(address, bytes32) external view returns (address) {
        return elsewhere;
    }

    function predictPot(address, bytes32, bool) external view returns (address) {
        return elsewhere;
    }

    function predictSharedPot(bytes32) external view returns (address) {
        return elsewhere;
    }

    fallback() external payable {
        address target = released;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    receive() external payable {}
}
