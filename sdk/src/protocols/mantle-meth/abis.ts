// One ABI for two contracts: `stake`, `mETHToETH` and `ethToMETH` are the Staking contract's
// (`staking` in addresses.ts); `balanceOf` and `approve` are the mETH token's (`mETH`).
export const METHABI = [
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
