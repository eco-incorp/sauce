<!-- Generated from the SDK's registries. Do not edit. -->

# Eco Routes (`eco-routes`)

> Eco Routes is a building block that other protocols are built on. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Eco's cross-chain intent protocol. A Portal publishes an intent, escrows its reward in a per-intent vault, and pays a solver who fulfills the route on the destination chain; a prover carries the proof of that fulfillment back. This is the layer Sauce intents are built on.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `EcoRoutes` on ethereum, optimism, unichain, polygon, monad, ronin, arc, base, plasma, arbitrum |
| Chains | none recorded |

## In a program

The registry records no deployment: `PortalABI` is an interface, bound to an address the
program is given.

```ts
import PortalABI from "./protocols/eco-routes/PortalABI.json";

// The contract's address, a `main` argument.
function main(contract: Address) {
  const target = PortalABI.at(contract);
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
- `fulfillAndProve(bytes32 intentHash, (bytes32 salt, uint64 deadline, address portal, uint256 nativeAmount, (address token, uint256 amount)[] tokens, (address target, bytes data, uint256 value)[] calls) route, bytes32 rewardHash, bytes32 claimant, address prover, uint64 sourceChainDomainID, bytes data) payable returns (bytes[])`
- `prove(address prover, uint64 sourceChainDomainID, bytes32[] intentHashes, bytes data) payable`
- `withdraw(uint64 destination, bytes32 routeHash, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward)`
- `batchWithdraw(uint64[] destinations, bytes32[] routeHashes, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens)[] rewards)`
- `refund(uint64 destination, bytes32 routeHash, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward)`
- `refundTo(uint64 destination, bytes32 routeHash, (uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens) reward, address refundee)`
- `cancel(bytes32 intentHash, (bytes32 salt, uint64 deadline, address portal, uint256 nativeAmount, (address token, uint256 amount)[] tokens, (address target, bytes data, uint256 value)[] calls) route, bytes32 rewardHash)`
- `cancelAndProve(bytes32 intentHash, (bytes32 salt, uint64 deadline, address portal, uint256 nativeAmount, (address token, uint256 amount)[] tokens, (address target, bytes data, uint256 value)[] calls) route, bytes32 rewardHash, address prover, uint64 sourceChainDomainID, bytes data) payable`
- `version() pure returns (string)`

### `ProverABI`

`import ProverABI from "./protocols/eco-routes/ProverABI.json";` Speaks for: HyperProver, MetaProver, PolymerProver, LayerZeroProver.

- `provenIntents(bytes32 intentHash) view returns ((address claimant, uint64 destination))`
- `getProofType() pure returns (string)`
- `version() pure returns (string)`
- `PORTAL() view returns (address)`
- `isWhitelisted(bytes32 addr) view returns (bool)`
- `fetchFee(uint64 domainID, bytes encodedProofs, bytes data) view returns (uint256)`
