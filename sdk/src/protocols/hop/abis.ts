export const HopL1BridgeABI = [
  {
    name: "sendToL2",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "chainId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "relayer", type: "address" },
      { name: "relayerFee", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const HopL2AmmWrapperABI = [
  {
    name: "swapAndSend",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "chainId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "bonderFee", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "destinationAmountOutMin", type: "uint256" },
      { name: "destinationDeadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
