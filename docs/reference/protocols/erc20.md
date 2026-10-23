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

## What it offers

- **transfer**: Send tokens to an address
- **approve**: Authorize a spender to transfer tokens on your behalf
- **transferFrom**: Transfer tokens from one address to another (requires approval)
- **balanceOf**: Query token balance of an address
- **allowance**: Query remaining approved amount for a spender

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
