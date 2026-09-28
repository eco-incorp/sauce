// LayerBank routes every user action through Core, naming the market (lToken); the lToken's own
// supply/borrow/redeem functions are Core-only. The lToken ABI here is its read surface.
export const LTokenABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "underlyingBalanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "borrowBalanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "exchangeRate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "underlying",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const LayerBankCoreABI = [
  {
    name: "enterMarkets",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "lTokens", type: "address[]" }],
    outputs: [],
  },
  {
    name: "exitMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "lToken", type: "address" }],
    outputs: [],
  },
  {
    name: "supply",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "lToken", type: "address" },
      { name: "uAmount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "redeemToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lToken", type: "address" },
      { name: "lAmount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "redeemUnderlying",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lToken", type: "address" },
      { name: "uAmount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lToken", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "repayBorrow",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "lToken", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
