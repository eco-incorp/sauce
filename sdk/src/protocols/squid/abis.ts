// SquidRouter (Axelar-based). `bridgeCall` bridges a gateway token by symbol; `callBridgeCall` first
// runs source-chain calls (e.g. a swap into the bridged token), then bridges.
export const SquidRouterABI = [
  {
    name: "bridgeCall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "bridgedTokenSymbol", type: "string" },
      { name: "amount", type: "uint256" },
      { name: "destinationChain", type: "string" },
      { name: "destinationAddress", type: "string" },
      { name: "payload", type: "bytes" },
      { name: "gasRefundRecipient", type: "address" },
      { name: "enableExpress", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "callBridgeCall",
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
      { name: "payload", type: "bytes" },
      { name: "gasRefundRecipient", type: "address" },
      { name: "enableExpress", type: "bool" },
    ],
    outputs: [],
  },
] as const;
