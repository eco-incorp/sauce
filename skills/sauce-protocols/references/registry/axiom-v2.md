<!-- Generated from the SDK's registries. Do not edit. -->

# Axiom V2 (`axiom-v2`)

ZK coprocessor over a chain's history: a query reads block headers, accounts, storage, transactions and receipts, a compute circuit proves a result over them, and AxiomV2Query calls the requester back with the proven results. Axiom ended support for V2 on December 21, 2024: the contracts remain deployed and unfrozen, but no prover has fulfilled a query since.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | `Axiom`: `axiom-v2` |
| Namespace | `AxiomV2` on ethereum, base |
| Chains | ethereum, base |
| Document | [axiom-v2.md](../axiom-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `AxiomV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's query, `0x83c8c0B395850bA55c830451Cfaca4F2A667a983`.
  require(AxiomV2.Query != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | query | `0x83c8c0B395850bA55c830451Cfaca4F2A667a983` | `AxiomV2.Query` |
| [Base](../../../sauce-chains/references/base.md) | query | `0xfe059442B0379D5f22Bec384A588766f98A36812` | `AxiomV2.Query` |

## ABI

### `AxiomV2QueryABI`

`import AxiomV2QueryABI from "./protocols/axiom-v2/AxiomV2QueryABI.json";` Speaks for: query.

- `sendQuery(uint64 sourceChainId, bytes32 dataQueryHash, (uint8 k, uint16 resultLen, bytes32[] vkey, bytes computeProof) computeQuery, (address target, bytes extraData) callback, (uint64 maxFeePerGas, uint32 callbackGasLimit, uint256 overrideAxiomQueryFee) feeData, bytes32 userSalt, address refundee, bytes dataQuery) payable returns (uint256 queryId)`
- `increaseQueryGas(uint256 queryId, uint64 newMaxFeePerGas, uint32 newCallbackGasLimit, uint256 overrideAxiomQueryFee) payable`
- `refundQuery((address caller, bytes32 userSalt, bytes32 queryHash, bytes32 callbackHash, address refundee) queryWitness)`
- `deposit(address payor) payable`
- `withdraw(uint256 amount, address payee)`
- `axiomQueryFee() view returns (uint256)`
- `proofVerificationGas() view returns (uint32)`
- `minMaxFeePerGas() view returns (uint64)`
- `queryDeadlineInterval() view returns (uint32)`
- `queries(uint256) view returns (uint8 state, uint32 deadlineBlockNumber, uint32 callbackGasLimit, address payee, uint256 payment)`
- `balances(address) view returns (uint256)`
- `frozen() view returns (bool)`
