// A Premia v3 option pool (one PoolProxy per base/quote/strike/maturity/type, deployed by the
// PoolFactory and routed through the pool Diamond's facets). Sizes and prices are 18-decimal
// fixed point; `delta` fields are signed.
export const DiamondABI = [
  {
    name: "trade",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "size", type: "uint256" },
      { name: "isBuy", type: "bool" },
      { name: "premiumLimit", type: "uint256" },
      { name: "referrer", type: "address" },
    ],
    outputs: [
      { name: "totalPremium", type: "uint256" },
      {
        name: "delta",
        type: "tuple",
        components: [
          { name: "collateral", type: "int256" },
          { name: "longs", type: "int256" },
          { name: "shorts", type: "int256" },
        ],
      },
    ],
  },
  {
    name: "exercise",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "exerciseValue", type: "uint256" },
      { name: "exerciseFee", type: "uint256" },
    ],
  },
  {
    name: "settle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "collateral", type: "uint256" }],
  },
] as const;
