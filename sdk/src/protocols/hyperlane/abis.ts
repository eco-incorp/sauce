export const HyperlaneMailboxABI = [
  {
    name: "dispatch",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_destinationDomain", type: "uint32" },
      { name: "_recipientAddress", type: "bytes32" },
      { name: "_messageBody", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "quoteDispatch",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_destinationDomain", type: "uint32" },
      { name: "_recipientAddress", type: "bytes32" },
      { name: "_messageBody", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "process",
    type: "function",
    stateMutability: "payable",
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
    inputs: [{ name: "_id", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "dispatch",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "destinationDomain", type: "uint32" },
      { name: "recipientAddress", type: "bytes32" },
      { name: "messageBody", type: "bytes" },
      { name: "hookMetadata", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "quoteDispatch",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "destinationDomain", type: "uint32" },
      { name: "recipientAddress", type: "bytes32" },
      { name: "messageBody", type: "bytes" },
      { name: "defaultHookMetadata", type: "bytes" },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
  {
    name: "localDomain",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
] as const;
