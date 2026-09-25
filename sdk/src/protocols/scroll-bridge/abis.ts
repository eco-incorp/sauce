export const ScrollL1MessengerABI = [
  {
    name: "sendMessage",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "message", type: "bytes" },
      { name: "gasLimit", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const ScrollL1GatewayRouterABI = [
  {
    name: "depositETH",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "_gasLimit", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "depositERC20",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_token", type: "address" },
      { name: "_amount", type: "uint256" },
      { name: "_gasLimit", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
