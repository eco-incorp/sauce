export const LRTDepositPoolABI = [
  {
    name: "depositAsset",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "depositAmount", type: "uint256" },
      { name: "minRSETHAmountExpected", type: "uint256" },
      { name: "referralId", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "getRsETHAmountToMint",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "rsethAmountToMint", type: "uint256" }],
  },
] as const;

export const RsETHABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
