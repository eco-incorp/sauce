export const UniProxyABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "deposit0", type: "uint256" },
      { name: "deposit1", type: "uint256" },
      { name: "to", type: "address" },
      { name: "pos", type: "address" },
      { name: "minIn", type: "uint256[4]" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "getDepositAmount",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "pos", type: "address" },
      { name: "token", type: "address" },
      { name: "_deposit", type: "uint256" },
    ],
    outputs: [
      { name: "amountStart", type: "uint256" },
      { name: "amountEnd", type: "uint256" },
    ],
  },
] as const;

export const HypervisorABI = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "to", type: "address" },
      { name: "from", type: "address" },
      { name: "minAmounts", type: "uint256[4]" },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getTotalAmounts",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "total0", type: "uint256" },
      { name: "total1", type: "uint256" },
    ],
  },
] as const;
