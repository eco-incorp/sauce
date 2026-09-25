export const PolygonRootChainManagerABI = [
  {
    name: "depositEtherFor",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
  {
    name: "depositFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "rootToken", type: "address" },
      { name: "depositData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "exit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "inputData", type: "bytes" }],
    outputs: [],
  },
] as const;
