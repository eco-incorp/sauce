// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title MockKyberRouter
/// @notice The slice of KyberSwap's MetaAggregationRouterV2 that `@sauce/swap`'s `kyber` drives:
///         `swap` with the router's own parameter struct, so calldata encoded for the real router
///         reaches it unchanged. It pulls the input from the caller and pays a set amount to
///         `desc.dstReceiver`, holding the router's floor (`minReturnAmount`).
/// @dev `pay` is what a swap pays out, `take` what it pulls (zero: all of `desc.amount`), and
///      `refuse` makes every swap revert.
contract MockKyberRouter {
    struct SwapDescriptionV2 {
        address srcToken;
        address dstToken;
        address[] srcReceivers;
        uint256[] srcAmounts;
        address[] feeReceivers;
        uint256[] feeAmounts;
        address dstReceiver;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
        bytes permit;
    }

    struct SwapExecutionParams {
        address callTarget;
        address approveTarget;
        bytes targetData;
        SwapDescriptionV2 desc;
        bytes clientData;
    }

    uint256 public pay;
    uint256 public take;
    bool public refuse;

    function set(uint256 _pay, uint256 _take, bool _refuse) external {
        pay = _pay;
        take = _take;
        refuse = _refuse;
    }

    function swap(SwapExecutionParams calldata execution)
        external
        payable
        returns (uint256 returnAmount, uint256 gasUsed)
    {
        require(!refuse, "MockKyberRouter: refused");
        SwapDescriptionV2 calldata desc = execution.desc;
        IERC20(desc.srcToken).transferFrom(msg.sender, address(this), take == 0 ? desc.amount : take);
        IERC20(desc.dstToken).transfer(desc.dstReceiver, pay);
        require(pay >= desc.minReturnAmount, "Return amount is not enough");
        return (pay, 0);
    }
}
