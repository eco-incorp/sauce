// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A protocol that carries the requester's bytes back, for `@sauce/async`'s suite, in the shape of
// every echoing protocol (a bridge's message, a proof's extra data): `send(payload)` keeps what the
// requester sent and answers an id; later, in a transaction of its own, `deliver(id, value)` calls
// the requester back with `carried(bytes payload, bytes value)`, the payload as it was sent and a
// value the protocol produced. `carried` is a selector neither a Pot nor its Router declares, so the
// call reaches the Router's fallback and the handler the Pot registered for it.
//
// `deliver` is anyone's to call and keeps the message, so a suite can deliver it twice. A callback
// that reverts reverts `deliver` with its reason.
//
// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `CarrierProtocol.json` beside
// this file.
contract CarrierProtocol {
    struct Message {
        address requester;
        bytes payload;
    }

    mapping(uint256 => Message) public messages;
    uint256 public sent;

    function send(bytes calldata payload) external returns (uint256 id) {
        id = ++sent;
        messages[id] = Message(msg.sender, payload);
    }

    function deliver(uint256 id, bytes calldata value) external returns (bytes memory) {
        Message storage m = messages[id];
        require(m.requester != address(0), "no such message");
        (bool ok, bytes memory result) =
            m.requester.call(abi.encodeWithSignature("carried(bytes,bytes)", m.payload, value));
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }
}
