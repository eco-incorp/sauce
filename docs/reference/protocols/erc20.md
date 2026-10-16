<!-- Generated from the SDK's registries. Do not edit. -->

# ERC20 (`erc20`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> ERC20 is a building block that other protocols are built on. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

The standard interface for fungible tokens on EVM chains (EIP-20). Defines transfer, approve, transferFrom, balanceOf, allowance, totalSupply, name, symbol, and decimals.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | none: import its ABI |
| Chains | none recorded |

## Key Operations

- **transfer**: Send tokens to an address
- **approve**: Authorize a spender to transfer tokens on your behalf
- **transferFrom**: Transfer tokens from one address to another (requires approval)
- **balanceOf**: Query token balance of an address
- **allowance**: Query remaining approved amount for a spender

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Transfer tokens
import { transfer } from "@sauce/token";
function main(token: Address, to: Address, amount: Uint256): Uint256 {
  transfer(token, to, amount);
  return 1;
}

// Approve spender
import { approve } from "@sauce/token";
function main(token: Address, spender: Address, amount: Uint256): Uint256 {
  approve(token, spender, amount);
  return 1;
}

// Transfer from (requires prior approval)
import { transferFrom } from "@sauce/token";
function main(token: Address, from: Address, to: Address, amount: Uint256): Uint256 {
  transferFrom(token, from, to, amount);
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

## Notes

- Standard interface (EIP-20) - not a specific deployment, no fixed addresses
- Every fungible token on every EVM chain implements this interface
- approve before transferFrom: spender must be approved by the owner first
- Common pattern: approve max (type(uint256).max) for DeFi interactions, or use exact amounts for security
- decimals varies: most tokens use 18, USDC/USDT use 6, WBTC uses 8
- Some tokens (USDT) do not return bool from transfer/approve. The writes above are `@sauce/token`'s, which follow OpenZeppelin SafeERC20: empty returndata is accepted from a contract, a `false` return reverts, and `approve` resets a non-zero allowance to zero first. They return nothing, since a refused write reverts the program
- `ERC20ABI.at(token).transfer(...)` is the raw ABI call and is NOT SafeERC20: it reverts on a token that returns nothing and accepts one that returns `false`. Use it only when that is what you mean
- The storageTransfer example demonstrates how to implement ERC-20 logic entirely in SauceScript using storage operations

## Its names in a program

The registry records no deployment: `ERC20ABI` is an interface, bound to an address the
program is given.

```ts
import ERC20ABI from "./protocols/erc20/ERC20ABI.json";

// The contract's address, a `main` argument.
function main(contract: Address) {
  const target = ERC20ABI.at(contract);
}
```

## ABI

### `ERC20ABI`

`import ERC20ABI from "./protocols/erc20/ERC20ABI.json";`

- `transfer(address to, uint256 amount) returns (bool)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `allowance(address owner, address spender) view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `name() view returns (string)`
- `symbol() view returns (string)`
- `decimals() view returns (uint8)`
