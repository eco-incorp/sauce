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
      { name: "exclusivityParameter", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    // The current entry point: every address is a bytes32, so a deposit can name a non-EVM
    // (e.g. Solana) recipient or token. The legacy address-typed `deposit` is gone from the
    // deployed SpokePools.
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "depositor", type: "bytes32" },
      { name: "recipient", type: "bytes32" },
      { name: "inputToken", type: "bytes32" },
      { name: "outputToken", type: "bytes32" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "bytes32" },
      { name: "quoteTimestamp", type: "uint32" },
      { name: "fillDeadline", type: "uint32" },
      { name: "exclusivityParameter", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const AcrossHubPoolABI = [
  {
    name: "liquidityUtilizationCurrent",
    type: "function",
    // Not a view: it syncs the pool's balances before computing, so it must not be STATICCALLed.
    stateMutability: "nonpayable",
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
      { name: "utilizedReserves", type: "int256" },
      { name: "liquidReserves", type: "uint256" },
      { name: "undistributedLpFees", type: "uint256" },
    ],
  },
] as const;
