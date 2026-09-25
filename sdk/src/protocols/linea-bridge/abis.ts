export const LineaL1MessageServiceABI = [
  {
    name: "sendMessage",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_to", type: "address" },
      { name: "_fee", type: "uint256" },
      { name: "_calldata", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "claimMessage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_from", type: "address" },
      { name: "_to", type: "address" },
      { name: "_fee", type: "uint256" },
      { name: "_value", type: "uint256" },
      { name: "_feeRecipient", type: "address" },
      { name: "_calldata", type: "bytes" },
      { name: "_nonce", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
