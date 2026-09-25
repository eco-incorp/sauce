export const BaseL1StandardBridgeABI = [
  {
    name: "depositETH",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_minGasLimit", type: "uint32" },
      { name: "_extraData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "depositERC20",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_l1Token", type: "address" },
      { name: "_l2Token", type: "address" },
      { name: "_amount", type: "uint256" },
      { name: "_minGasLimit", type: "uint32" },
      { name: "_extraData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "depositETHTo",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_to", type: "address" },
      { name: "_minGasLimit", type: "uint32" },
      { name: "_extraData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "depositERC20To",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_l1Token", type: "address" },
      { name: "_l2Token", type: "address" },
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
      { name: "_minGasLimit", type: "uint32" },
      { name: "_extraData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
