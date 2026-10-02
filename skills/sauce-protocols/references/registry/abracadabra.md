<!-- Generated from the SDK's registries. Do not edit. -->

# Abracadabra (`abracadabra`)

Lending protocol that lets users borrow MIM stablecoin against yield-bearing collateral via isolated Cauldron markets built on DegenBox.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Abracadabra` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |
| Document | [abracadabra.md](../abracadabra.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Abracadabra` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's degenBox, `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce`.
  require(Abracadabra.DegenBox != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | degenBox | `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce` | `Abracadabra.DegenBox` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | mim | `0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3` | `Abracadabra.Mim` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | degenBox | `0x7C8FeF8eA9b1fE46A7689bfb8149341C90431D38` | `Abracadabra.DegenBox` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | mim | `0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A` | `Abracadabra.Mim` |

## ABI

### `CauldronABI`

`import CauldronABI from "./protocols/abracadabra/CauldronABI.json";`

- `addCollateral(address to, bool skim, uint256 share)`
- `removeCollateral(address to, uint256 share)`
- `borrow(address to, uint256 amount) returns (uint256 part, uint256 share)`
- `repay(address to, bool skim, uint256 part) returns (uint256 amount)`
- `userCollateralShare(address user) view returns (uint256)`
- `userBorrowPart(address user) view returns (uint256)`

### `DegenBoxABI`

`import DegenBoxABI from "./protocols/abracadabra/DegenBoxABI.json";` Speaks for: degenBox.

- `deposit(address token, address from, address to, uint256 amount, uint256 share) payable returns (uint256 amountOut, uint256 shareOut)`
- `withdraw(address token, address from, address to, uint256 amount, uint256 share) returns (uint256 amountOut, uint256 shareOut)`
- `balanceOf(address token, address user) view returns (uint256)`
