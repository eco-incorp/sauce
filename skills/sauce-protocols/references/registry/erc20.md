<!-- Generated from the SDK's registries. Do not edit. -->

# ERC20 (`erc20`)

The ERC-20 token standard interface. Defines the common API for fungible tokens on EVM chains: transfer, approve, transferFrom, balanceOf, allowance, totalSupply, name, symbol, decimals.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | none: import its ABI |
| Chains | none recorded |
| Document | [erc20.md](../erc20.md): what it is for, how to choose it, its pitfalls |

## In a program

The registry records no deployment: `ERC20ABI` is an interface, bound to an address the
program is given.

```sauce chain=ethereum
import ERC20ABI from "./protocols/erc20/ERC20ABI.json";

const TARGET = 0n; // the contract's address, as a define

function main() {
  const target = ERC20ABI.at(TARGET);
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
