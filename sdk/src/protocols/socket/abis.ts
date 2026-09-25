export const SocketGatewayABI = [
  {
    name: "bridge",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "routeId", type: "uint32" },
      { name: "bridgeData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "executeRoute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "routeId", type: "uint32" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
  },
] as const;
