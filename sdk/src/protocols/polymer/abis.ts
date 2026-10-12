// Polymer's CrossL2ProverV2 (polymerdao/prover-contracts contracts/core/prove_api/CrossL2ProverV2.sol).
// A proof names one log by where it sits: the chain it was emitted on, its block, its receipt's index
// and its index in that receipt. `validateEvent` checks the sequencer's signature over Polymer's state
// root and the log's membership under exactly that key, and answers the log; `inspectLogIdentifier`
// reads the same four values out of the proof without checking anything, so after `validateEvent`
// passed they identify the log, which is what a receiver records to refuse the same proof twice.
export const CrossL2ProverV2ABI = [
  {
    type: "function",
    name: "validateEvent",
    stateMutability: "view",
    inputs: [{ name: "proof", type: "bytes" }],
    outputs: [
      { name: "chainId", type: "uint32" },
      { name: "emittingContract", type: "address" },
      { name: "topics", type: "bytes" },
      { name: "unindexedData", type: "bytes" },
    ],
  },
  {
    type: "function",
    name: "inspectLogIdentifier",
    stateMutability: "pure",
    inputs: [{ name: "proof", type: "bytes" }],
    outputs: [
      { name: "srcChain", type: "uint32" },
      { name: "blockNumber", type: "uint64" },
      { name: "receiptIndex", type: "uint32" },
      { name: "logIndex", type: "uint32" },
    ],
  },
] as const;
