// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Compiled by `solc 0.8.36 --optimize` against the npm package `@openzeppelin/contracts@5.6.1`
// (integrity sha512-Ly6SlsVJ3mj+b18W3R8gNufB7dTICT105fJhodGAGgyC2oqnBAhqSiNDJ8V8DLY05cCz81GLI0CU5vNYA1EC/w==),
// with the remapping `@openzeppelin/contracts/=<that package's root>/`.

/// @notice OpenZeppelin's own `SafeERC20`, one external entry per write the Sauce side spells, so
/// the matrix in `evm.e2e.test.ts` RUNS the reference on every cell instead of asserting what it
/// would do.
contract SafeERC20Reference {
    using SafeERC20 for IERC20;

    function transfer(IERC20 token, address to, uint256 amount) external {
        token.safeTransfer(to, amount);
    }

    function transferFrom(IERC20 token, address from, address to, uint256 amount) external {
        token.safeTransferFrom(from, to, amount);
    }

    function approve(IERC20 token, address spender, uint256 amount) external {
        token.forceApprove(spender, amount);
    }

    /// @notice An UNCHECKED call from this contract, for giving it the same starting state as the
    /// Pot it is compared with (a standing allowance, say).
    function raw(address target, bytes calldata data) external {
        (bool ok, ) = target.call(data);
        require(ok, "raw call reverted");
    }
}
