export const DODOV2ProxyABI = [
  {
    name: "dodoSwapV2TokenToToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fromToken", type: "address" },
      { name: "toToken", type: "address" },
      { name: "fromTokenAmount", type: "uint256" },
      { name: "minReturnAmount", type: "uint256" },
      { name: "dodoPairs", type: "address[]" },
      { name: "directions", type: "uint256" },
      { name: "isIncentive", type: "bool" },
      { name: "deadLine", type: "uint256" },
    ],
    outputs: [{ name: "returnAmount", type: "uint256" }],
  },
] as const;
