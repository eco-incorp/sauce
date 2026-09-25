export const AcrossSpokePoolABI = [
  {
    name: "depositV3",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "depositor", type: "address" },
      { name: "recipient", type: "address" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "address" },
      { name: "quoteTimestamp", type: "uint32" },
      { name: "fillDeadline", type: "uint32" },
      { name: "exclusivityDeadline", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "originToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "relayerFeePct", type: "uint64" },
      { name: "quoteTimestamp", type: "uint32" },
      { name: "message", type: "bytes" },
      { name: "maxCount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const AcrossHubPoolABI = [
  {
    name: "liquidityUtilizationCurrent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "l1Token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "pooledTokens",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "l1Token", type: "address" }],
    outputs: [
      { name: "lpToken", type: "address" },
      { name: "isEnabled", type: "bool" },
      { name: "lastLpFeeUpdate", type: "uint32" },
      { name: "utilizedReserves", type: "uint256" },
      { name: "liquidReserves", type: "uint256" },
      { name: "undistributedLpFees", type: "uint256" },
    ],
  },
] as const;
