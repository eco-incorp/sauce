<!-- Generated from the SDK's registries. Do not edit. -->

# Fluid (`fluid`)

Liquidity layer that unifies lending and DEX liquidity. Deposited assets simultaneously serve as lending collateral and DEX liquidity.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, arbitrum |
| Document | [fluid.md](../fluid.md): what it is for, how to choose it, its pitfalls |

## In a program

The registry records no deployment: `FluidLendingABI` is an interface, bound to an address the
program is given.

```sauce chain=ethereum
import FluidLendingABI from "./protocols/fluid/FluidLendingABI.json";

const TARGET = 0n; // the contract's address, as a define

function main() {
  const target = FluidLendingABI.at(TARGET);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | no registry ABI |

## ABI

### `FluidLendingABI`

`import FluidLendingABI from "./protocols/fluid/FluidLendingABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `asset() view returns (address)`

### `FluidVaultABI`

`import FluidVaultABI from "./protocols/fluid/FluidVaultABI.json";`

- `operate(uint256 nftId, int256 newCol, int256 newDebt, address to) payable returns (uint256, int256, int256)`
