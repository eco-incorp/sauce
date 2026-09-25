export const FlashAggregatorABI = [
  {
    name: "flashLoan",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokens", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "route", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "extraData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "getRoutes",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "routes", type: "uint16[]" }],
  },
] as const;
