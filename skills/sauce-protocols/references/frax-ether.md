# Frax Ether

Frax Finance's liquid staking derivative. Two tokens: frxETH (pegged 1:1 to ETH) and sfrxETH (yield-bearing ERC-4626 vault token that accrues staking yield).

## Category

liquid-staking | Chains and addresses: [registry/frax-ether.md](registry/frax-ether.md)

## Key Operations

- **submitAndDeposit**: Stake ETH and deposit directly into sfrxETH vault (one-step)
- **deposit**: Deposit frxETH into sfrxETH vault
- **redeem**: Redeem sfrxETH shares for frxETH

## SauceScript Examples

```typescript
// Stake ETH and get sfrxETH directly
import { FrxETHMinterABI as IFrxETHMinter } from "./abis";
function main(minterAddress: Address, recipient: Address): Uint256 {
  const minter = IFrxETHMinter.at(minterAddress);
  return minter.submitAndDeposit(recipient);
}

// Deposit frxETH into sfrxETH vault
import { SfrxETHABI as ISfrxETH } from "./abis";
function main(sfrxethAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const sfrxeth = ISfrxETH.at(sfrxethAddress);
  return sfrxeth.deposit(assets, receiver);
}

// Redeem sfrxETH for frxETH
import { SfrxETHABI as ISfrxETH } from "./abis";
function main(
  sfrxethAddress: Address,
  shares: Uint256,
  receiver: Address,
  owner: Address,
): Uint256 {
  const sfrxeth = ISfrxETH.at(sfrxethAddress);
  return sfrxeth.redeem(shares, receiver, owner);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/frax-ether.md](registry/frax-ether.md).

## Notes

- TVL: $700M+. sfrxETH is ERC-4626 compliant (same interface as Yearn V3, pufETH)
- submitAndDeposit() is payable - send ETH as msg.value. One-step ETH -> sfrxETH
- frxETH does not earn yield on its own - must be deposited into sfrxETH vault
- Approve frxETH to sfrxETH contract before calling deposit()
