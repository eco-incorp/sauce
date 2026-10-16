<!-- Generated from the SDK's registries. Do not edit. -->

# Mantle mETH (`mantle-meth`)

> Mantle mETH is a liquid staking protocol: stake a chain's coin and get back a token you can still
> use. This page lists the chains it is deployed on, the name a program writes for each of its
> contracts, and the functions a program can call.

Mantle's liquid staking token for Ethereum. Stake ETH and receive mETH, a non-rebasing token that accrues staking rewards over time.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `MantleMeth` on ethereum |
| Chains | ethereum |

## Key Operations

- **stake**: Stake ETH for mETH with minimum output check

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Stake ETH for mETH
import { METHStakingABI as IStaking } from "./abis";
function main(stakingAddress: Address, minMETHAmount: Uint256): Uint256 {
  const staking = IStaking.at(stakingAddress);
  staking.stake(minMETHAmount);
  return 1;
}
```

## Notes

- TVL: $1.5B+. Non-rebasing token backed by Mantle treasury
- stake() is payable - send ETH as msg.value
- minMETHAmount param provides slippage protection
- Use mETHToETH()/ethToMETH() to preview exchange rates
- The Staking contract (`staking`), not the token.
- The mETH token (`mETH`).

## Its names in a program

On Ethereum, `MantleMeth` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's mETH, `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa`.
  require(MantleMeth.METH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | mETH | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` | `MantleMeth.METH` |
| [Ethereum](../chains/ethereum.md) | staking | `0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f` | `MantleMeth.Staking` |

## ABI

### `METHABI`

`import METHABI from "./protocols/mantle-meth/METHABI.json";` Speaks for: mETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `METHStakingABI`

`import METHStakingABI from "./protocols/mantle-meth/METHStakingABI.json";` Speaks for: staking.

- `stake(uint256 minMETHAmount) payable`
- `mETHToETH(uint256 mETHAmount) view returns (uint256)`
- `ethToMETH(uint256 ethAmount) view returns (uint256)`
