export const BorrowerOperationsABI = [
  {
    name: "openTrove",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_maxFeePercentage", type: "uint256" },
      { name: "_LUSDAmount", type: "uint256" },
      { name: "_upperHint", type: "address" },
      { name: "_lowerHint", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "closeTrove",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "adjustTrove",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_maxFeePercentage", type: "uint256" },
      { name: "_collWithdrawal", type: "uint256" },
      { name: "_LUSDChange", type: "uint256" },
      { name: "_isDebtIncrease", type: "bool" },
      { name: "_upperHint", type: "address" },
      { name: "_lowerHint", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "repayLUSD",
    type: "function",
    stateMutability: "nonpayable",
    // `_upperHint`/`_lowerHint` locate the trove's new position in the sorted list; the zero
    // address is valid (the list is then searched from the ends, at a higher gas cost).
    inputs: [
      { name: "_LUSDAmount", type: "uint256" },
      { name: "_upperHint", type: "address" },
      { name: "_lowerHint", type: "address" },
    ],
    outputs: [],
  },
] as const;
