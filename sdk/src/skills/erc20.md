# ERC-20

The standard interface for fungible tokens on EVM chains (EIP-20). Defines transfer, approve, transferFrom, balanceOf, allowance, totalSupply, name, symbol, and decimals.

## Category

infrastructure | Chains: (standard interface, any chain)

## Key Operations

- **transfer**: Send tokens to an address
- **approve**: Authorize a spender to transfer tokens on your behalf
- **transferFrom**: Transfer tokens from one address to another (requires approval)
- **balanceOf**: Query token balance of an address
- **allowance**: Query remaining approved amount for a spender

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/erc20";
```

## SauceScript Examples

```typescript
// Transfer tokens
import { ERC20ABI as IERC20 } from "./abis";
function main(token: Address, to: Address, amount: Uint256): Uint256 {
  const t = IERC20.at(token);
  t.transfer(to, amount);
  return 1;
}

// Approve spender
import { ERC20ABI as IERC20 } from "./abis";
function main(token: Address, spender: Address, amount: Uint256): Uint256 {
  const t = IERC20.at(token);
  t.approve(spender, amount);
  return 1;
}

// Transfer from (requires prior approval)
import { ERC20ABI as IERC20 } from "./abis";
function main(token: Address, from: Address, to: Address, amount: Uint256): Uint256 {
  const t = IERC20.at(token);
  t.transferFrom(from, to, amount);
  return 1;
}

// Check balance
import { ERC20ABI as IERC20 } from "./abis";
function main(token: Address, account: Address): Uint256 {
  const t = IERC20.at(token);
  return t.balanceOf(account);
}

// Storage-based transfer (demonstrates storage, crypto, abi encode, events)
function balanceSlot(account: Address): Uint256 {
  return crypto.keccak256(abi.encode(account, 1));
}
function main(to: Address, amount: Uint256): Uint256 {
  const from = ctx.msgSender();
  const fromSlot = balanceSlot(from);
  const fromBalance = evm.sload(fromSlot);
  if (fromBalance < amount) throw "insufficient balance";
  evm.sstore(fromSlot, fromBalance - amount);
  const toSlot = balanceSlot(to);
  evm.sstore(toSlot, evm.sload(toSlot) + amount);
  log(abi.encode(from, to, amount), crypto.keccak256("Transfer(address,address,uint256)"));
  return 1;
}
```

## ABI Methods

### ERC20ABI

- `transfer(address,uint256)` - Transfer tokens. Params: to (recipient), amount (token amount). Returns bool success
- `approve(address,uint256)` - Approve spender. Params: spender (authorized address), amount (max transfer amount). Returns bool success
- `transferFrom(address,address,uint256)` - Transfer from approved address. Params: from (source), to (destination), amount. Returns bool success
- `balanceOf(address)` - Query balance. Params: account. Returns uint256 balance
- `allowance(address,address)` - Query allowance. Params: owner, spender. Returns uint256 remaining allowance
- `totalSupply()` - Total token supply. Returns uint256
- `name()` - Token name. Returns string
- `symbol()` - Token symbol. Returns string
- `decimals()` - Token decimals. Returns uint8 (typically 18; USDC/USDT use 6)

### Events

- `Transfer(address indexed from, address indexed to, uint256 value)` - Emitted on transfer and transferFrom
- `Approval(address indexed owner, address indexed spender, uint256 value)` - Emitted on approve

## Notes

- Standard interface (EIP-20) - not a specific deployment, no fixed addresses
- Every fungible token on every EVM chain implements this interface
- approve before transferFrom: spender must be approved by the owner first
- Common pattern: approve max (type(uint256).max) for DeFi interactions, or use exact amounts for security
- decimals varies: most tokens use 18, USDC/USDT use 6, WBTC uses 8
- Some tokens (USDT) do not return bool from transfer/approve -- use SafeERC20 wrapper for compatibility
- The storageTransfer example demonstrates how to implement ERC-20 logic entirely in SauceScript using storage operations
