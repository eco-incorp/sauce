# Reflexer

Non-pegged stablecoin protocol issuing RAI. Uses a PID controller to dampen RAI price volatility against ETH collateral.

## Category

cdp | Chains and addresses: [registry/reflexer.md](registry/reflexer.md)

## Key Operations

- **exitRai**: Exit RAI from the system (withdraw RAI tokens)
- **joinRai**: Join RAI into the system (deposit RAI tokens)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Exit RAI from system
import { CoinJoinABI as ICoinJoin } from "./abis";
function main(coinJoinAddress: Address, account: Address, amount: Uint256): Uint256 {
  const coinJoin = ICoinJoin.at(coinJoinAddress);
  coinJoin.exit(account, amount);
  return 1;
}

// Join RAI into system
import { CoinJoinABI as ICoinJoin } from "./abis";
function main(coinJoinAddress: Address, account: Address, amount: Uint256): Uint256 {
  const coinJoin = ICoinJoin.at(coinJoinAddress);
  coinJoin.join(account, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/reflexer.md](registry/reflexer.md).

## Notes

- RAI is non-pegged, floating around $3 - NOT a $1 stablecoin
- PID controller adjusts the redemption rate to dampen RAI price volatility
- Inspired by MakerDAO but with a non-pegged design philosophy
- SAFEs (similar to MakerDAO Vaults) hold ETH collateral backing RAI debt
- coinJoin converts between internal system debt units and external RAI ERC-20
- ethJoin converts between ETH and internal collateral accounting
