<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Ether (`frax-ether`)

> Frax Ether is a liquid staking protocol: stake a chain's coin and get back a token you can still
> use. This page lists the chains it is deployed on, the name a program writes for each of its
> contracts, and the functions a program can call.

Frax Finance's liquid staking derivative. Two tokens: frxETH (pegged 1:1 to ETH) and sfrxETH (yield-bearing ERC-4626 vault token that accrues staking yield).

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `FraxEther` on ethereum |
| Chains | ethereum |

## Key Operations

- **submitAndDeposit**: Stake ETH and deposit directly into sfrxETH vault (one-step)
- **deposit**: Deposit frxETH into sfrxETH vault
- **redeem**: Redeem sfrxETH shares for frxETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- TVL: $700M+. sfrxETH is ERC-4626 compliant (same interface as Yearn V3, pufETH)
- submitAndDeposit() is payable - send ETH as msg.value. One-step ETH -> sfrxETH
- frxETH does not earn yield on its own - must be deposited into sfrxETH vault
- Approve frxETH to sfrxETH contract before calling deposit()

## Its names in a program

On Ethereum, `FraxEther` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's frxETHMinter, `0xbAFA44EFE7901E04E39Dad13167D089C559c1138`.
  require(FraxEther.FrxETHMinter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | frxETHMinter | `0xbAFA44EFE7901E04E39Dad13167D089C559c1138` | `FraxEther.FrxETHMinter` |
| [Ethereum](../chains/ethereum.md) | sfrxETH | `0xac3E018457B222d93114458476f3E3416Abbe38F` | `FraxEther.SfrxETH` |

## ABI

### `FrxETHMinterABI`

`import FrxETHMinterABI from "./protocols/frax-ether/FrxETHMinterABI.json";` Speaks for: frxETHMinter.

- `submitAndDeposit(address recipient) payable returns (uint256 shares)`

### `SfrxETHABI`

`import SfrxETHABI from "./protocols/frax-ether/SfrxETHABI.json";` Speaks for: sfrxETH.

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
