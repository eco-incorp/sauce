// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Stands in for a Kitchen that minted Pots before signed cooks (kitchen-evm 1.2.0): it answers the
/// three calls that release's Pot makes while it is constructed and afterwards, and CREATE2s the
/// init code it is handed under that release's own salt, `keccak256(abi.encode(owner, salt))` for a
/// Private Pot whose Router is not fixed. The Pot reads its owner, salt and Router back from
/// `msg.sender`, so this contract is the Pot's `kitchen()` exactly as the real Kitchen is a
/// released Pot's.
///
/// Nothing of the Pot is embedded here: `test/evm/fixtures/pot-kitchen-evm-1.2.0.json` holds the
/// released creation code, pinned by its hash, and the test passes it in.
///
/// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `OldPotDeployer.json` beside
/// this file.
contract OldPotDeployer {
    address public immutable router;
    uint256 public immutable executionFee;

    address private owner_;
    bytes32 private salt_;

    constructor(address router_, uint256 executionFee_) {
        router = router_;
        executionFee = executionFee_;
    }

    /// The Pot's constructor reads who it is for: (owner, salt, routerFixed), here never fixed.
    function potParameters() external view returns (address, bytes32, bool) {
        return (owner_, salt_, false);
    }

    /// Mints the Pot `initCode` creates for `owner` and `salt`, at `CREATE2(this, gateSalt,
    /// keccak256(initCode))`.
    function deploy(
        bytes calldata initCode,
        address owner,
        bytes32 salt
    ) external returns (address pot) {
        owner_ = owner;
        salt_ = salt;
        bytes memory code = initCode;
        bytes32 gateSalt = keccak256(abi.encode(owner, salt));
        assembly {
            pot := create2(0, add(code, 32), mload(code), gateSalt)
        }
        require(pot != address(0), "create2 failed");
    }
}
