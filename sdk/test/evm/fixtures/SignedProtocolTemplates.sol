// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

/// ABI-compatible callees for the REAL registry templates, not substitutes for their programs.
/// Compiled by `solc 0.8.36 --evm-version cancun --optimize --combined-json abi,bin` into
/// `SignedProtocolTemplates.json` beside this file; no Solidity toolchain is needed at test time.
contract SignedProtocolTemplates {
    int256 public lastCollateralDelta;
    int256 public lastDebtDelta;
    int24 public lastTickLower;
    int24 public lastTickUpper;
    int128 public lastI;
    int128 public lastJ;
    int96 public lastCreatedFlowrate;
    int96 public lastUpdatedFlowrate;

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function operate(uint256 nftId, int256 newCol, int256 newDebt, address)
        external payable returns (uint256, int256, int256)
    {
        lastCollateralDelta = newCol;
        lastDebtDelta = newDebt;
        return (nftId, newCol, newDebt);
    }

    function mint(MintParams calldata params)
        external payable returns (uint256, uint128, uint256, uint256)
    {
        lastTickLower = params.tickLower;
        lastTickUpper = params.tickUpper;
        return (7, 11, params.amount0Desired, params.amount1Desired);
    }

    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {
        return (1, -5, 2, 3, 1);
    }

    function getPrice(bytes32) external pure returns (Price memory) {
        return Price(-42, 3, -8, 1234);
    }

    function swap(address, address, uint256, bool, bool, uint128, uint16, uint128, uint128, uint8)
        external payable returns (int128, int128)
    {
        return (-1000, 999);
    }

    /// `getPool` is a view, so it cannot record what it received: it returns the tick spacing it
    /// was given as an address (`0x…c8` for 200), which the test reads back from the cook.
    function getPool(address, address, int24 tickSpacing) external pure returns (address) {
        return address(uint160(uint24(tickSpacing)));
    }

    function exchange(int128 i, int128 j, uint256 amount, uint256) external returns (uint256) {
        lastI = i;
        lastJ = j;
        return amount;
    }

    function createFlow(address, address, address, int96 flowrate, bytes calldata)
        external returns (bool)
    {
        lastCreatedFlowrate = flowrate;
        return true;
    }

    function updateFlow(address, address, address, int96 flowrate, bytes calldata)
        external returns (bool)
    {
        lastUpdatedFlowrate = flowrate;
        return true;
    }
}
