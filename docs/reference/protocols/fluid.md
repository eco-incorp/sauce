<!-- Generated from the SDK's registries. Do not edit. -->

# Fluid (`fluid`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Fluid is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Liquidity layer that unifies lending and DEX liquidity. Deposited assets simultaneously serve as lending collateral and DEX liquidity.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Fluid` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Notes

- Novel architecture: deposited assets serve dual purpose as lending collateral AND DEX liquidity
- No interest rate mode selection -- all rates are algorithmically determined
- Same contract address on Ethereum and Arbitrum
- Built by the Instadapp team
- All deposit/repay operations require ERC-20 approval (to the fToken or Vault)
- TVL: $1B+. Audited

## Its names in a program

On Ethereum, `Fluid` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's liquidity, `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497`.
  require(Fluid.Liquidity != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |
| [Arbitrum One](../chains/arbitrum.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `FluidLendingABI`

`import FluidLendingABI from "./protocols/fluid/FluidLendingABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `asset() view returns (address)`: the address is a token

### `FluidVaultABI`

`import FluidVaultABI from "./protocols/fluid/FluidVaultABI.json";`

- `operate(uint256 nftId, int256 newCol, int256 newDebt, address to) payable returns (uint256, int256, int256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
