export const HyperlaneMailboxABI = [
  {
    name: "dispatch",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_destinationDomain", type: "uint32" },
      { name: "_recipientAddress", type: "uint256" },
      { name: "_messageBody", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "quoteDispatch",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_destinationDomain", type: "uint32" },
      { name: "_recipientAddress", type: "uint256" },
      { name: "_messageBody", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "process",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_metadata", type: "bytes" },
      { name: "_message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "delivered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
