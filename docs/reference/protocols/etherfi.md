<!-- Generated from the SDK's registries. Do not edit. -->

# ether.fi (`etherfi`)

> ether.fi is a restaking protocol: staked coins put to work securing other services too. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Decentralized, non-custodial liquid restaking protocol. Stake ETH to receive eETH (rebasing), or wrap it as weETH (non-rebasing) for DeFi composability. Natively restaked via EigenLayer.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Etherfi` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Stake ETH and receive eETH
- **wrap**: Wrap eETH into weETH (non-rebasing)
- **unwrap**: Unwrap weETH back to eETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit ETH for eETH
import { LiquidityPoolABI as ILiquidityPool } from "./abis";
function main(liquidityPoolAddress: Address): Uint256 {
  const pool = ILiquidityPool.at(liquidityPoolAddress);
  return pool.deposit();
}

// Wrap eETH to weETH
import { WeETHABI as IWeETH } from "./abis";
function main(weethAddress: Address, amount: Uint256): Uint256 {
  const weeth = IWeETH.at(weethAddress);
  return weeth.wrap(amount);
}

// Unwrap weETH to eETH
import { WeETHABI as IWeETH } from "./abis";
function main(weethAddress: Address, amount: Uint256): Uint256 {
  const weeth = IWeETH.at(weethAddress);
  return weeth.unwrap(amount);
}
```

## Notes

- TVL: $5.8B+. Largest liquid restaking protocol
- eETH rebases like stETH. Use weETH for DeFi (Aave, Pendle, etc.)
- deposit() is payable - send ETH as msg.value
- Approve eETH to weETH contract before wrapping
- Natively restaked on EigenLayer for additional AVS yield

## Its names in a program

On Ethereum, `Etherfi` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's eETH, `0x35fA164735182de50811E8e2E824cFb9B6118ac2`.
  require(Etherfi.EETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | eETH | `0x35fA164735182de50811E8e2E824cFb9B6118ac2` | `Etherfi.EETH` |
| [Ethereum](../chains/ethereum.md) | liquidityPool | `0x308861A430be4cce5502d0A12724771Fc6DaF216` | `Etherfi.LiquidityPool` |
| [Ethereum](../chains/ethereum.md) | weETH | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` | `Etherfi.WeETH` |

## ABI

### `EETHABI`

`import EETHABI from "./protocols/etherfi/EETHABI.json";` Speaks for: eETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/etherfi/LiquidityPoolABI.json";` Speaks for: liquidityPool.

- `deposit() payable returns (uint256)`

### `WeETHABI`

`import WeETHABI from "./protocols/etherfi/WeETHABI.json";` Speaks for: weETH.

- `wrap(uint256 _eETHAmount) returns (uint256)`
- `unwrap(uint256 _weETHAmount) returns (uint256)`
- `getEETHByWeETH(uint256 _weETHAmount) view returns (uint256)`
- `getWeETHByeETH(uint256 _eETHAmount) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
