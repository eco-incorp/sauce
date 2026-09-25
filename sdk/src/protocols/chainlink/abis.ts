export const AggregatorV3ABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint128" },
      { name: "answer", type: "uint256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint128" },
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
      { name: "roundId", type: "uint128" },
      { name: "answer", type: "uint256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint128" },
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
