// The mETH token (`mETH` in addresses.ts).
export const METHABI = [
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

// The Staking contract (`staking` in addresses.ts): staking and the mETH/ETH rate live here, not
// on the token.
export const METHStakingABI = [
  {
    name: "stake",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "minMETHAmount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "mETHToETH",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "mETHAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "ethToMETH",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "ethAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
