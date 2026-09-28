// The LI.FI Diamond routes each bridge through its own facet entry point
// (`startBridgeTokensVia<Bridge>`); there is no generic `startBridgeTokensViaBridge`. This declares
// the Across V4 facet's, plus the calldata-verification facet's `extractBridgeData`.
export const LiFiDiamondABI = [
  {
    name: "startBridgeTokensViaAcrossV4",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "bridgeData",
        type: "tuple",
        components: [
          { name: "transactionId", type: "bytes32" },
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
      {
        name: "acrossData",
        type: "tuple",
        components: [
          { name: "receiverAddress", type: "bytes32" },
          { name: "refundAddress", type: "bytes32" },
          { name: "sendingAssetId", type: "bytes32" },
          { name: "receivingAssetId", type: "bytes32" },
          { name: "outputAmount", type: "uint256" },
          { name: "outputAmountMultiplier", type: "uint128" },
          { name: "exclusiveRelayer", type: "bytes32" },
          { name: "quoteTimestamp", type: "uint32" },
          { name: "fillDeadline", type: "uint32" },
          { name: "exclusivityParameter", type: "uint32" },
          { name: "message", type: "bytes" },
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
          { name: "transactionId", type: "bytes32" },
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
