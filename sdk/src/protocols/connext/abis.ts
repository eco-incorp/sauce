export const EverclearSpokeABI = [
  {
    name: "newIntent",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "destinations", type: "uint32[]" },
      { name: "to", type: "address" },
      { name: "inputAsset", type: "address" },
      { name: "outputAsset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "maxFee", type: "uint32" },
      { name: "ttl", type: "uint64" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "intentId", type: "uint256" }],
  },
] as const;
