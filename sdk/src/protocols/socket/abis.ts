// The SocketGateway has no `bridge(uint32,bytes)`: every route, bridge or swap, runs through
// `executeRoute` (or its fallback, keyed by a leading route id).
export const SocketGatewayABI = [
  {
    name: "executeRoute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "routeId", type: "uint32" },
      { name: "routeData", type: "bytes" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
  },
] as const;
