export const AggregatorV3ABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const FeedRegistryABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "base", type: "address" },
      { name: "quote", type: "address" },
    ],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    name: "getFeed",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "base", type: "address" },
      { name: "quote", type: "address" },
    ],
    outputs: [{ name: "aggregator", type: "address" }],
  },
] as const;

// Chainlink CRE's KeystoneForwarder (smartcontractkit/chainlink-evm, contracts/cre/src/v1/
// KeystoneForwarder.sol at b6427ea1, "KeystoneForwarder 1.0.0"): verifies a workflow's signed
// report and calls the receiver's `onReport(bytes metadata, bytes report)`, after an ERC-165 check
// that the receiver supports `IReceiver`. A report is attempted once per (receiver, workflow
// execution, report id); one whose `onReport` reverted may be retried.
export const KeystoneForwarderABI = [
  {
    name: "typeAndVersion",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "isForwarder",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "forwarder", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getTransmissionId",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "workflowExecutionId", type: "bytes32" },
      { name: "reportId", type: "bytes2" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "getTransmissionInfo",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "workflowExecutionId", type: "bytes32" },
      { name: "reportId", type: "bytes2" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "transmissionId", type: "bytes32" },
          { name: "state", type: "uint8" },
          { name: "transmitter", type: "address" },
          { name: "invalidReceiver", type: "bool" },
          { name: "success", type: "bool" },
          { name: "gasLimit", type: "uint80" },
        ],
      },
    ],
  },
  {
    name: "getTransmitter",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "workflowExecutionId", type: "bytes32" },
      { name: "reportId", type: "bytes2" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "report",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "rawReport", type: "bytes" },
      { name: "reportContext", type: "bytes" },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "ReportProcessed",
    inputs: [
      { name: "receiver", type: "address", indexed: true },
      { name: "workflowExecutionId", type: "bytes32", indexed: true },
      { name: "reportId", type: "bytes2", indexed: true },
      { name: "result", type: "bool", indexed: false },
    ],
  },
] as const;
