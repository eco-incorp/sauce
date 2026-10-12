// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// The ERC-165 check Chainlink's KeystoneForwarder makes before it delivers a report: OpenZeppelin
// 4.8.3's `ERC165Checker.supportsInterface(receiver, IReceiver)`, which the forwarder links (its
// `route`, chainlink-evm contracts/cre/src/v1/KeystoneForwarder.sol at b6427ea1). Three static calls
// of exactly 30,000 gas each — the receiver supports ERC-165, does not support 0xffffffff, and
// supports the interface — each counted only when it succeeds and answers a nonzero word.
//
// `query` is `supportsERC165InterfaceUnchecked` as OpenZeppelin writes it, with the gas each call
// used beside its answer, so a suite holds the receiver to the 30,000 the forwarder gives it.
contract Erc165Probe {
    function query(address account, bytes4 interfaceId) public view returns (bool supported, uint256 gasUsed) {
        bytes memory encodedParams = abi.encodeWithSelector(bytes4(0x01ffc9a7), interfaceId);
        bool success;
        uint256 returnSize;
        uint256 returnValue;
        uint256 before = gasleft();
        assembly {
            success := staticcall(30000, account, add(encodedParams, 0x20), mload(encodedParams), 0x00, 0x20)
            returnSize := returndatasize()
            returnValue := mload(0x00)
        }
        gasUsed = before - gasleft();
        supported = success && returnSize >= 0x20 && returnValue > 0;
    }

    function supportsInterface(address account, bytes4 interfaceId) external view returns (bool) {
        (bool erc165, ) = query(account, 0x01ffc9a7);
        (bool invalid, ) = query(account, 0xffffffff);
        (bool wanted, ) = query(account, interfaceId);
        return erc165 && !invalid && wanted;
    }
}
