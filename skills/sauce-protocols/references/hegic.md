# Hegic

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

## Category

options | Chains and addresses: [registry/hegic.md](registry/hegic.md)

## Key Operations

- **exerciseOption**: Exercise an options position to claim profit

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Exercise option: the OperationalTreasury pays off the position to `account`
import { HegicABI as IHegic } from "./abis";
function main(treasuryAddress: Address, optionId: Uint256, account: Address): Uint256 {
  const treasury = IHegic.at(treasuryAddress);
  treasury.payOff(optionId, account);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/hegic.md](registry/hegic.md).

## Notes

- Simplified options UX - no order books, instant settlement
- Supports ETH and BTC options on Arbitrum
- Options are represented as NFTs with unique IDs
- Exercise is only profitable if option is in-the-money at time of exercise
