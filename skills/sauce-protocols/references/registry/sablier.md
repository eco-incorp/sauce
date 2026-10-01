<!-- Generated from the SDK's registries. Do not edit. -->

# Sablier (`sablier`)

Token streaming protocol for continuous payments. Supports linear, cliff, and dynamic vesting schedules with NFT-based stream ownership.

| Fact | Value |
| --- | --- |
| Category | Payments and streaming |
| Family | none |
| Namespace | `Sablier` on ethereum |
| Chains | ethereum |
| Document | [sablier.md](../sablier.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Sablier` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's lockupLinear, `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`.
  require(Sablier.LockupLinear != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lockupLinear | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` | `Sablier.LockupLinear` |

## ABI

### `LockupLinearABI`

`import LockupLinearABI from "./protocols/sablier/LockupLinearABI.json";` Speaks for: lockupLinear.

- `createWithDurations((address sender, address recipient, uint128 totalAmount, address asset, bool cancelable, bool transferable, (uint40 cliff, uint40 total) durations, (address account, uint256 fee) broker) params) returns (uint256 streamId)`
- `withdraw(uint256 streamId, address to, uint128 amount)`
- `cancel(uint256 streamId)`
