// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Fixtures for `sauce pools` (`pools-anvil.ts`): a token with the decimals and symbol it is
/// given, a helper that adds liquidity to and swaps on a real Uniswap V3 pool (`@uniswap/v3-core`),
/// and stand-ins for the two venue contracts a local chain cannot run — an Aerodrome Slipstream
/// CLFactory's pool lookup and Uniswap V4's StateView. Compiled by `solc 0.8.36 --optimize
/// --combined-json abi,bin` into `PoolsToken.json`, `PoolsLiquidity.json`,
/// `SlipstreamFactoryStub.json` and `StateViewStub.json` beside this file.

/// A plain ERC-20 with an open `mint`.
contract PoolsToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory symbol_, uint8 decimals_) {
        name = symbol_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256 amount0, uint256 amount1);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// Adds liquidity to a Uniswap V3 pool and swaps on it, paying each callback from the account that
/// asked, out of that account's allowance to this contract.
contract PoolsLiquidity {
    function mint(address pool, int24 tickLower, int24 tickUpper, uint128 liquidity) external {
        IUniswapV3PoolLike(pool).mint(msg.sender, tickLower, tickUpper, liquidity, abi.encode(msg.sender));
    }

    function swap(address pool, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96)
        external
        returns (int256 amount0, int256 amount1)
    {
        return IUniswapV3PoolLike(pool).swap(
            msg.sender, zeroForOne, amountSpecified, sqrtPriceLimitX96, abi.encode(msg.sender)
        );
    }

    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata data) external {
        _pay(amount0, amount1, data);
    }

    function uniswapV3SwapCallback(int256 amount0, int256 amount1, bytes calldata data) external {
        _pay(amount0 > 0 ? uint256(amount0) : 0, amount1 > 0 ? uint256(amount1) : 0, data);
    }

    function _pay(uint256 amount0, uint256 amount1, bytes calldata data) private {
        address payer = abi.decode(data, (address));
        if (amount0 > 0) IERC20Like(IUniswapV3PoolLike(msg.sender).token0()).transferFrom(payer, msg.sender, amount0);
        if (amount1 > 0) IERC20Like(IUniswapV3PoolLike(msg.sender).token1()).transferFrom(payer, msg.sender, amount1);
    }
}

/// An Aerodrome Slipstream CLFactory's pool lookup: the tick spacings it enables, and
/// `getPool(tokenA, tokenB, tickSpacing)` answering whatever pool was set.
contract SlipstreamFactoryStub {
    int24[] private spacings;
    mapping(address => mapping(address => mapping(int24 => address))) public getPool;

    function setTickSpacings(int24[] calldata each) external {
        spacings = each;
    }

    function tickSpacings() external view returns (int24[] memory) {
        return spacings;
    }

    function setPool(address tokenA, address tokenB, int24 tickSpacing, address pool) external {
        getPool[tokenA][tokenB][tickSpacing] = pool;
        getPool[tokenB][tokenA][tickSpacing] = pool;
    }
}

/// Uniswap V4's StateView, answering for the pools and ticks set: a pool never set has no price,
/// as an uninitialized one.
contract StateViewStub {
    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        uint24 protocolFee;
        uint24 lpFee;
    }

    mapping(bytes32 => Slot0) private slot0s;
    mapping(bytes32 => uint128) public getLiquidity;
    mapping(bytes32 => mapping(int16 => uint256)) public getTickBitmap;
    mapping(bytes32 => mapping(int24 => int128)) private liquidityNets;

    function setPool(
        bytes32 poolId,
        uint160 sqrtPriceX96,
        int24 tick,
        uint24 protocolFee,
        uint24 lpFee,
        uint128 liquidity
    ) external {
        slot0s[poolId] = Slot0(sqrtPriceX96, tick, protocolFee, lpFee);
        getLiquidity[poolId] = liquidity;
    }

    function setTick(bytes32 poolId, int16 word, uint256 bitmap, int24 tick, int128 liquidityNet) external {
        getTickBitmap[poolId][word] = bitmap;
        liquidityNets[poolId][tick] = liquidityNet;
    }

    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        Slot0 memory slot = slot0s[poolId];
        return (slot.sqrtPriceX96, slot.tick, slot.protocolFee, slot.lpFee);
    }

    function getTickLiquidity(bytes32 poolId, int24 tick)
        external
        view
        returns (uint128 liquidityGross, int128 liquidityNet)
    {
        liquidityNet = liquidityNets[poolId][tick];
        liquidityGross = uint128(liquidityNet < 0 ? -liquidityNet : liquidityNet);
    }
}
