// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A protocol that answers later, for `@sauce/async`'s suite, in the shape every request-id protocol
// has (Chainlink VRF, Pyth Entropy, Chainlink Functions): `request(value)` records who asked and
// for what and answers an id; later, in a transaction of its own, `fulfill(id)` calls the requester
// back with `echo(uint256 id, uint256 value)`. `echo` is a selector neither a Pot nor its Router
// declares, so the call reaches the Router's fallback and the handler the Pot registered for it.
//
// `fulfill` is anyone's to call, as a relayer's or a coordinator's delivery is, and it keeps the
// request, so a suite can deliver it twice. A callback that reverts reverts `fulfill` with its
// reason.
//
// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `EchoProtocol.json` beside this
// file.
contract EchoProtocol {
    struct Pending {
        address requester;
        uint256 value;
    }

    event Requested(uint256 indexed id, address indexed requester, uint256 value);

    mapping(uint256 => Pending) public pending;
    uint256 public requests;

    function request(uint256 value) external returns (uint256 id) {
        id = uint256(keccak256(abi.encode(address(this), ++requests)));
        pending[id] = Pending(msg.sender, value);
        emit Requested(id, msg.sender, value);
    }

    function fulfill(uint256 id) external returns (bytes memory) {
        Pending memory p = pending[id];
        require(p.requester != address(0), "no such request");
        (bool ok, bytes memory result) =
            p.requester.call(abi.encodeWithSignature("echo(uint256,uint256)", id, p.value));
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }
}
