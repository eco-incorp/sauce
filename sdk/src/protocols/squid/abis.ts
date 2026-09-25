export const SquidRouterABI = [
  {
    name: "bridgeCall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "callType", type: "uint8" },
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
          { name: "payload", type: "bytes" },
        ],
      },
      { name: "bridgedTokenSymbol", type: "string" },
      { name: "destinationChain", type: "string" },
      { name: "destinationAddress", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "callBridge",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "bridgedTokenSymbol", type: "string" },
      { name: "destinationChain", type: "string" },
      { name: "destinationAddress", type: "string" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
