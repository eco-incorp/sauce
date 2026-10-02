<!-- Generated from the SDK's registries. Do not edit. -->

# Rocket Pool (`rocket-pool`)

Decentralised Ethereum liquid staking protocol. Stake ETH and receive rETH, a non-rebasing liquid staking token backed by a decentralized network of permissionless node operators.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `RocketPool` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Stake ETH and receive rETH
- **burn**: Burn rETH to redeem ETH (subject to pool liquidity)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit ETH for rETH
import { RocketDepositPoolABI as IRocketDepositPool } from "./abis";
function main(depositPoolAddress: Address): Uint256 {
  const pool = IRocketDepositPool.at(depositPoolAddress);
  pool.deposit();
  return 1;
}

// Burn rETH back to ETH
import { RETHABI as IRETH } from "./abis";
function main(rethAddress: Address, amount: Uint256): Uint256 {
  const reth = IRETH.at(rethAddress);
  reth.burn(amount);
  return 1;
}
```

## Notes

- TVL: $3B+. Most decentralized LST with permissionless node operators
- rETH is non-rebasing: value increases over time relative to ETH
- deposit() is payable - send ETH as msg.value, no parameters needed
- burn() may fail if insufficient liquidity in the deposit pool
- Exchange rate only goes up (barring slashing events)

## Its names in a program

On Ethereum, `RocketPool` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's rETH, `0xae78736Cd615f374D3085123A210448E74Fc6393`.
  require(RocketPool.RETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | rETH | `0xae78736Cd615f374D3085123A210448E74Fc6393` | `RocketPool.RETH` |
| [Ethereum](../chains/ethereum.md) | rocketDepositPool | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` | `RocketPool.RocketDepositPool` |

## ABI

### `RETHABI`

`import RETHABI from "./protocols/rocket-pool/RETHABI.json";` Speaks for: rETH.

- `getExchangeRate() view returns (uint256)`
- `getRethValue(uint256 _ethAmount) view returns (uint256)`
- `getEthValue(uint256 _rethAmount) view returns (uint256)`
- `burn(uint256 _rethAmount)`
- `balanceOf(address account) view returns (uint256)`

### `RocketDepositPoolABI`

`import RocketDepositPoolABI from "./protocols/rocket-pool/RocketDepositPoolABI.json";` Speaks for: rocketDepositPool.

- `deposit() payable`
