export const BoosterABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_pid", type: "uint256" },
      { name: "_amount", type: "uint256" },
      { name: "_stake", type: "bool" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_pid", type: "uint256" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "poolLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "poolInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "lptoken", type: "address" },
      { name: "token", type: "address" },
      { name: "gauge", type: "address" },
      { name: "crvRewards", type: "address" },
      { name: "stash", type: "address" },
      { name: "shutdown", type: "bool" },
    ],
  },
] as const;

export const BaseRewardPoolABI = [
  {
    name: "getReward",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_account", type: "address" },
      { name: "_claimExtras", type: "bool" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "earned",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
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
    name: "withdrawAndUnwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "claim", type: "bool" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
