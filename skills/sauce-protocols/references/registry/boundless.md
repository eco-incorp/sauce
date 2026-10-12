<!-- Generated from the SDK's registries. Do not edit. -->

# Boundless (`boundless`)

RISC Zero's proof market: a requestor offers ETH for a proof that a guest program (its image id) ran on an input, provers bid by locking the request with collateral, and BoundlessMarket verifies the proof, pays the prover and calls the requestor's callback with the guest's journal.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Boundless` on base |
| Chains | base |
| Document | [boundless.md](../boundless.md): what it is for, how to choose it, its pitfalls |

## In a program

On Base, `Boundless` is a namespace: its contracts need no import.

```sauce chain=base
function main() {
  // Base's market, `0xfd152dadc5183870710fe54f939eae3ab9f0fe82`.
  require(Boundless.Market != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | market | `0xfd152dadc5183870710fe54f939eae3ab9f0fe82` | `Boundless.Market` |

## ABI

### `BoundlessMarketABI`

`import BoundlessMarketABI from "./protocols/boundless/BoundlessMarketABI.json";` Speaks for: market.

- `submitRequest((uint256 id, ((address addr, uint96 gasLimit) callback, (uint8 predicateType, bytes data) predicate, bytes4 selector) requirements, string imageUrl, (uint8 inputType, bytes data) input, (uint256 minPrice, uint256 maxPrice, uint64 rampUpStart, uint32 rampUpPeriod, uint32 lockTimeout, uint32 timeout, uint256 lockCollateral) offer) request, bytes clientSignature) payable`
- `lockRequest((uint256 id, ((address addr, uint96 gasLimit) callback, (uint8 predicateType, bytes data) predicate, bytes4 selector) requirements, string imageUrl, (uint8 inputType, bytes data) input, (uint256 minPrice, uint256 maxPrice, uint64 rampUpStart, uint32 rampUpPeriod, uint32 lockTimeout, uint32 timeout, uint256 lockCollateral) offer) request, bytes clientSignature)`
- `fulfill(((uint256 id, (uint8 predicateType, bytes data) predicate, (address addr, uint96 gasLimit) callback, bytes4 selector, bytes32 imageUrlHash, bytes32 inputDigest, bytes32 offerDigest)[] requests, (bytes32 claimDigest, uint8 fulfillmentDataType, bytes fulfillmentData, bytes seal)[] fills, bytes assessorSeal, address prover)[] fulfillmentBatches) returns (bytes[] paymentError)`
- `deposit() payable`
- `depositTo(address to) payable`
- `withdraw(uint256 value)`
- `balanceOf(address addr) view returns (uint256)`
- `slash(uint256 requestId)`
- `requestIsLocked(uint256 id) view returns (bool)`
- `requestIsFulfilled(uint256 id) view returns (bool)`
- `requestDeadline(uint256 id) view returns (uint64)`
- `eip712DomainSeparator() view returns (bytes32)`
- `COLLATERAL_TOKEN_CONTRACT() view returns (address)`
