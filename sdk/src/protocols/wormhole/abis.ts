export const WormholeCoreBridgeABI = [
  {
    name: "publishMessage",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "nonce", type: "uint32" },
      { name: "payload", type: "bytes" },
      { name: "consistencyLevel", type: "uint8" },
    ],
    outputs: [{ name: "sequence", type: "uint64" }],
  },
  {
    name: "messageFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const WormholeTokenBridgeABI = [
  {
    name: "transferTokens",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "recipientChain", type: "uint16" },
      { name: "recipient", type: "uint256" },
      { name: "arbiterFee", type: "uint256" },
      { name: "nonce", type: "uint32" },
    ],
    outputs: [{ name: "sequence", type: "uint64" }],
  },
  {
    name: "completeTransfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "encodedVm", type: "bytes" }],
    outputs: [],
  },
  {
    name: "wrappedAsset",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenChainId", type: "uint16" },
      { name: "tokenAddress", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
