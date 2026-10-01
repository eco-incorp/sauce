<!-- Generated from the SDK's registries. Do not edit. -->

# Sablier (`sablier`)

Token streaming protocol for continuous payments. Supports linear, cliff, and dynamic vesting schedules with NFT-based stream ownership.

| Fact | Value |
| --- | --- |
| Category | Payments and streaming |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [sablier.md](../sablier.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's lockupLinear):

```sauce chain=ethereum
import LockupLinearABI from "./protocols/sablier/LockupLinearABI.json";

const LOCKUP_LINEAR = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9n;

function main() {
  const bound = LockupLinearABI.at(LOCKUP_LINEAR);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lockupLinear | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` | `LockupLinearABI.at(0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9n)` |

## ABI

### `LockupLinearABI`

`import LockupLinearABI from "./protocols/sablier/LockupLinearABI.json";` Speaks for: lockupLinear.

- `createWithDurations((address sender, address recipient, uint128 totalAmount, address asset, bool cancelable, bool transferable, (uint40 cliff, uint40 total) durations, (address account, uint256 fee) broker) params) returns (uint256 streamId)`
- `withdraw(uint256 streamId, address to, uint128 amount)`
- `cancel(uint256 streamId)`
