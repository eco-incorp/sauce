export const ClearingHouseABI = [
  {
    name: "openPosition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "baseToken", type: "address" },
      { name: "isBaseToQuote", type: "bool" },
      { name: "isExactInput", type: "bool" },
      { name: "amount", type: "uint256" },
      { name: "oppositeAmountBound", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint256" },
      { name: "referralCode", type: "uint256" },
    ],
    outputs: [
      { name: "base", type: "uint256" },
      { name: "quote", type: "uint256" },
    ],
  },
  {
    name: "closePosition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "baseToken", type: "address" },
      { name: "sqrtPriceLimitX96", type: "uint256" },
      { name: "oppositeAmountBound", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "referralCode", type: "uint256" },
    ],
    outputs: [
      { name: "base", type: "uint256" },
      { name: "quote", type: "uint256" },
    ],
  },
  {
    name: "getAccountValue",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "trader", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const VaultABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getFreeCollateral",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "trader", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
