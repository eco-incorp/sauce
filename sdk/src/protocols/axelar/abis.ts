export const AxelarGatewayABI = [
  {
    name: "callContract",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "destinationChain", type: "string" },
      { name: "contractAddress", type: "string" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "callContractWithToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "destinationChain", type: "string" },
      { name: "contractAddress", type: "string" },
      { name: "payload", type: "bytes" },
      { name: "symbol", type: "string" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "sendToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "destinationChain", type: "string" },
      { name: "destinationAddress", type: "string" },
      { name: "symbol", type: "string" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "tokenAddresses",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "symbol", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const AxelarGasServiceABI = [
  {
    name: "payNativeGasForContractCall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "sender", type: "address" },
      { name: "destinationChain", type: "string" },
      { name: "destinationAddress", type: "string" },
      { name: "payload", type: "bytes" },
      { name: "refundAddress", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const AxelarITSABI = [
  {
    name: "interchainTransfer",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "destinationChain", type: "string" },
      { name: "destinationAddress", type: "bytes" },
      { name: "amount", type: "uint256" },
      { name: "metadata", type: "bytes" },
      { name: "gasValue", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
