export const ZkSyncDiamondProxyABI = [
  {
    name: "requestL2Transaction",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_contractL2", type: "address" },
      { name: "_l2Value", type: "uint256" },
      { name: "_calldata", type: "bytes" },
      { name: "_l2GasLimit", type: "uint256" },
      { name: "_l2GasPerPubdataByteLimit", type: "uint256" },
      { name: "_factoryDeps", type: "bytes[]" },
      { name: "_refundRecipient", type: "address" },
    ],
    outputs: [{ name: "canonicalTxHash", type: "uint256" }],
  },
  {
    name: "l2TransactionBaseCost",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_gasPrice", type: "uint256" },
      { name: "_l2GasLimit", type: "uint256" },
      { name: "_l2GasPerPubdataByteLimit", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
