export const MaverickV2RouterABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "pool", type: "address" },
      { name: "tokenAIn", type: "bool" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    name: "exactOutputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "pool", type: "address" },
      { name: "tokenAIn", type: "bool" },
      { name: "amountOut", type: "uint256" },
      { name: "amountInMaximum", type: "uint256" },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
    ],
  },
] as const;

export const MaverickV2FactoryABI = [
  {
    name: "lookup",
    type: "function",
    stateMutability: "view",
    // Paged: pools [startIndex, endIndex) for the pair. There is no two-argument overload.
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "startIndex", type: "uint256" },
      { name: "endIndex", type: "uint256" },
    ],
    outputs: [{ name: "pools", type: "address[]" }],
  },
] as const;
