// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// A Hyperlane Mailbox for the intent lifecycle suites, real where the eco-routes HyperProver
/// touches it and MOCKED where Hyperlane's off-chain half would be:
///
///  - `dispatch`, `quoteDispatch` and `defaultHook` have the Mailbox's signatures (IMailbox), and
///    `dispatch` charges the quoted fee, formats the message as Hyperlane's `Message` library does
///    (version, nonce, origin, sender, destination, recipient, body) and emits the Mailbox's own
///    `Dispatch` and `DispatchId` events, so a client reads a message id exactly as from a real one;
///  - `process` is the RELAYER AND ISM, mocked: whoever calls it delivers a message dispatched on
///    another chain's mailbox, with no validator signatures checked, by calling the recipient's
///    `handle(origin, sender, body)` from this mailbox (which `HyperProver.handle`'s `only(MAILBOX)`
///    requires) and emitting `Process`/`ProcessId`. A test calls it to stand in for Hyperlane
///    carrying the proof from the destination chain to the source chain.
///
/// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `MockMailbox.json` beside this
/// file.
interface IMessageRecipient {
    function handle(uint32 origin, bytes32 sender, bytes calldata body) external payable;
}

contract MockMailbox {
    event Dispatch(
        address indexed sender,
        uint32 indexed destination,
        bytes32 indexed recipient,
        bytes message
    );
    event DispatchId(bytes32 indexed messageId);
    event Process(uint32 indexed origin, bytes32 indexed sender, address indexed recipient);
    event ProcessId(bytes32 indexed messageId);

    uint8 public constant VERSION = 3;
    uint32 public immutable localDomain;
    uint256 public immutable fee;
    uint32 public nonce;
    mapping(bytes32 => bool) public delivered;

    constructor(uint32 domain, uint256 fee_) {
        localDomain = domain;
        fee = fee_;
    }

    function defaultHook() external pure returns (address) {
        return address(0);
    }

    function quoteDispatch(
        uint32,
        bytes32,
        bytes calldata,
        bytes calldata,
        address
    ) external view returns (uint256) {
        return fee;
    }

    function dispatch(
        uint32 destination,
        bytes32 recipient,
        bytes calldata body,
        bytes calldata,
        address
    ) external payable returns (bytes32 id) {
        require(msg.value >= fee, "MockMailbox: fee not paid");
        bytes memory message = abi.encodePacked(
            VERSION,
            nonce,
            localDomain,
            bytes32(uint256(uint160(msg.sender))),
            destination,
            recipient,
            body
        );
        nonce++;
        id = keccak256(message);
        emit Dispatch(msg.sender, destination, recipient, message);
        emit DispatchId(id);
    }

    /// The relayer and the ISM, mocked: delivers `message`, dispatched on another chain's mailbox.
    function process(bytes calldata, bytes calldata message) external {
        uint32 origin = uint32(bytes4(message[5:9]));
        bytes32 sender = bytes32(message[9:41]);
        uint32 destination = uint32(bytes4(message[41:45]));
        bytes32 recipient = bytes32(message[45:77]);
        require(destination == localDomain, "MockMailbox: not this domain");
        bytes32 id = keccak256(message);
        require(!delivered[id], "MockMailbox: delivered");
        delivered[id] = true;
        address to = address(uint160(uint256(recipient)));
        IMessageRecipient(to).handle(origin, sender, message[77:]);
        emit Process(origin, sender, to);
        emit ProcessId(id);
    }
}
