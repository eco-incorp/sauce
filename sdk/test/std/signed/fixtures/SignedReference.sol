// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// For `@sauce/signed`'s suite: the verification its `execute` handler makes, written natively, so
// the suite can state what the Sauce handler costs beside it. Never deployed anywhere but a test.
//
//   - `SignedReference` checks exactly what the handler checks (the same EIP-712 digest, a
//     non-malleable ECDSA signature or EIP-1271, the deadline, an unordered salt in the same
//     ERC-7201 namespace) and then cooks the program on the Pot it owns, forwarding the fee: one
//     signature verified natively, one cook. `verify` is the same without the cook.
//   - `TwoOfTwoWallet` is a contract that owns a Pot: a two-of-two multisig whose EIP-1271
//     signature is both owners' 65-byte signatures, 130 bytes, as a contract wallet's may be of any
//     length. Either owner may make it call.
//
// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `SignedReference.json` beside
// this file.

interface IPot {
    /// Returns the engine's output raw, with no ABI wrapper.
    function cook(address engine, bytes calldata program) external payable;
}

library Signatures {
    uint256 internal constant HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    /// The address a 65-byte `r ‖ s ‖ v` signature of `digest` recovers, or zero: refusing a
    /// malleable `s` and any `v` but 27 and 28.
    function recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }
}

contract SignedReference {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant EXECUTE_TYPEHASH =
        keccak256("Execute(bytes program,bytes32 salt,uint256 deadline)");
    bytes32 private constant NAME = keccak256("Sauce Pot");
    bytes32 private constant VERSION = keccak256("1");
    /// keccak256(abi.encode(uint256(keccak256("sauce.storage.Signed")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NAMESPACE =
        0x445da62d53bdea9331f042175775dc985d50361ac56f5f57e8a11871d9d99500;

    address public immutable signer;
    address public pot;
    address public engine;

    constructor(address signer_) {
        signer = signer_;
    }

    /// The Pot this contract owns and cooks on, once it is minted.
    function setPot(address pot_, address engine_) external {
        require(pot == address(0), "set");
        pot = pot_;
        engine = engine_;
    }

    /// Answers what the program returned, raw, as the Pot's `cook` does.
    function execute(bytes calldata program, bytes32 salt, uint256 deadline, bytes calldata signature)
        external
        payable
    {
        _verify(program, salt, deadline, signature);
        (bool ok, bytes memory result) =
            pot.call{value: msg.value}(abi.encodeCall(IPot.cook, (engine, program)));
        assembly {
            switch ok
            case 0 { revert(add(result, 32), mload(result)) }
            default { return(add(result, 32), mload(result)) }
        }
    }

    function verify(bytes calldata program, bytes32 salt, uint256 deadline, bytes calldata signature)
        external
    {
        _verify(program, salt, deadline, signature);
    }

    function _verify(bytes calldata program, bytes32 salt, uint256 deadline, bytes calldata signature)
        private
    {
        require(block.timestamp <= deadline, "signed: the deadline has passed");
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME, VERSION, block.chainid, pot));
        bytes32 digest = keccak256(
            abi.encodePacked(
                hex"1901",
                domain,
                keccak256(abi.encode(EXECUTE_TYPEHASH, keccak256(program), salt, deadline))
            )
        );
        require(_signedBy(signer, digest, signature), "signed: not the owner's signature");
        bytes32 slot = keccak256(abi.encode(uint256(salt) >> 8, NAMESPACE));
        uint256 bit = 1 << (uint256(salt) & 255);
        uint256 used;
        assembly {
            used := sload(slot)
        }
        require(used & bit == 0, "signed: the salt was used or cancelled");
        assembly {
            sstore(slot, or(used, bit))
        }
    }

    function _signedBy(address who, bytes32 digest, bytes calldata signature) private view returns (bool) {
        if (Signatures.recover(digest, signature) == who) return true;
        if (who.code.length == 0) return false;
        (bool ok, bytes memory answer) =
            who.staticcall(abi.encodeWithSelector(0x1626ba7e, digest, signature));
        return ok && answer.length >= 32 && bytes4(answer) == 0x1626ba7e;
    }

    receive() external payable {}
}

contract TwoOfTwoWallet {
    address public immutable first;
    address public immutable second;

    constructor(address first_, address second_) {
        first = first_;
        second = second_;
    }

    function call(address to, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        require(msg.sender == first || msg.sender == second, "not an owner");
        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }

    /// EIP-1271: both owners signed `hash`, the first's signature then the second's.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (
            signature.length == 130 && Signatures.recover(hash, signature[0:65]) == first
                && Signatures.recover(hash, signature[65:130]) == second
        ) {
            return 0x1626ba7e;
        }
        return 0xffffffff;
    }

    receive() external payable {}
}
