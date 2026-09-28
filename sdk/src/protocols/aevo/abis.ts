// Aevo's deposit contract is its OP Stack L1StandardBridge (behind an L1ChugSplashProxy): deposits
// go through the standard bridge entry points, which take the L2 token and a gas limit.
export const DepositContractABI = [
  {
    name: "depositERC20",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "l1Token", type: "address" },
      { name: "l2Token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "minGasLimit", type: "uint32" },
      { name: "extraData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "depositETH",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "minGasLimit", type: "uint32" },
      { name: "extraData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
