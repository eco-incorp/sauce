export const LiFiDiamondABI = [
  {
    name: "startBridgeTokensViaBridge",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "_bridgeData",
        type: "tuple",
        components: [
          { name: "transactionId", type: "uint256" },
          { name: "bridge", type: "string" },
          { name: "integrator", type: "string" },
          { name: "referrer", type: "address" },
          { name: "sendingAssetId", type: "address" },
          { name: "receiver", type: "address" },
          { name: "minAmount", type: "uint256" },
          { name: "destinationChainId", type: "uint256" },
          { name: "hasSourceSwaps", type: "bool" },
          { name: "hasDestinationCall", type: "bool" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "extractBridgeData",
    type: "function",
    stateMutability: "pure",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [
      {
        name: "bridgeData",
        type: "tuple",
        components: [
          { name: "transactionId", type: "uint256" },
          { name: "bridge", type: "string" },
          { name: "integrator", type: "string" },
          { name: "referrer", type: "address" },
          { name: "sendingAssetId", type: "address" },
          { name: "receiver", type: "address" },
          { name: "minAmount", type: "uint256" },
          { name: "destinationChainId", type: "uint256" },
          { name: "hasSourceSwaps", type: "bool" },
          { name: "hasDestinationCall", type: "bool" },
        ],
      },
    ],
  },
] as const;
