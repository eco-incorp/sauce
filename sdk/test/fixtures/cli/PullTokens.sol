// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Fixtures for `sauce run --fund`'s allowance and permit modes: two mintable ERC-20s with EIP-2612
/// `permit`, one that returns nothing from its writes (like USDT, which a SafeERC20 pull must accept)
/// and one whose `transferFrom` answers `false` and moves nothing (which a SafeERC20 pull must refuse,
/// reverting the whole run). Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into
/// `NoReturnPermitERC20.json` and `FalsePullPermitERC20.json` beside this file.

/// EIP-2612 over a plain allowance map: the domain is (name, "1", chainid, this).
abstract contract PermitBase {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function version() external pure returns (string memory) {
        return "1";
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "PERMIT: expired");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner, "PERMIT: invalid signature");
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _spend(address from, uint256 amount) internal {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ERC20: insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
    }
}

/// USDT's shape: writes return NOTHING, and `approve` refuses nonzero to nonzero.
contract NoReturnPermitERC20 is PermitBase {
    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        PermitBase(name_, symbol_, decimals_)
    {}

    function transfer(address to, uint256 amount) external {
        _move(msg.sender, to, amount);
    }

    function approve(address spender, uint256 amount) external {
        require(amount == 0 || allowance[msg.sender][spender] == 0, "USDT: nonzero to nonzero approve");
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        _spend(from, amount);
        _move(from, to, amount);
    }
}

/// Honest everywhere but the pull: `transferFrom` answers `false` and moves nothing.
contract FalsePullPermitERC20 is PermitBase {
    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        PermitBase(name_, symbol_, decimals_)
    {}

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
