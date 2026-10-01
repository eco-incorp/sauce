<!-- Generated from the SDK's registries. Do not edit. -->

# Eco Routes (`eco-routes`)

Eco's cross-chain intent protocol. A Portal publishes an intent, escrows its reward in a per-intent vault, and pays a solver who fulfills the route on the destination chain; a prover carries the proof of that fulfillment back. This is the layer Sauce intents are built on.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `EcoRoutes` on ethereum, optimism, unichain, polygon, monad, ronin, arc, base, plasma, arbitrum |
| Chains | none recorded |
| Document | none |

## In a program

The registry records no deployment: `PortalABI` is an interface, bound to an address the
program is given.

```sauce chain=ethereum
import PortalABI from "./protocols/eco-routes/PortalABI.json";

const TARGET = 0n; // the contract's address, as a define

function main() {
  const target = PortalABI.at(TARGET);
}
```

## ABI

### `PortalABI`

`import PortalABI from "./protocols/eco-routes/PortalABI.json";` Speaks for: Portal.

- `publish(uint64 destination, bytes route, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward) returns (bytes32 intentHash, address vault)`
- `publishAndFund(uint64 destination, bytes route, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward, bool allowPartial) payable returns (bytes32 intentHash, address vault)`
- `fund(uint64 destination, bytes32 routeHash, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward, bool allowPartial) payable returns (bytes32 intentHash)`
- `fulfill(bytes32 intentHash, (bytes32 salt, uint64 deadline, address portal, uint256 nativeAmount, (address token, uint256 amount)[] tokens, (address target, bytes data, uint256 value)[] calls) route, bytes32 rewardHash, bytes32 claimant) payable returns (bytes[])`
- `getIntentHash(uint64 destination, bytes route, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward) pure returns (bytes32 intentHash, bytes32 routeHash, bytes32 rewardHash)`
- `intentVaultAddress(uint64 destination, bytes route, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward) view returns (address)`
- `isIntentFunded(uint64 destination, bytes route, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward) view returns (bool)`
- `getRewardStatus(bytes32 intentHash) view returns (uint8)`
- `executor() view returns (address)`
- `claimants(bytes32 intentHash) view returns (bytes32)`

### `ProverABI`

`import ProverABI from "./protocols/eco-routes/ProverABI.json";` Speaks for: HyperProver, MetaProver, PolymerProver, LayerZeroProver.

- `provenIntents(bytes32 intentHash) view returns ((address claimant, uint64 destination))`
