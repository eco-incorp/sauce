export const SeaportABI = [
  {
    name: "fulfillBasicOrder",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "parameters",
        type: "tuple",
        components: [
          { name: "considerationToken", type: "address" },
          { name: "considerationIdentifier", type: "uint256" },
          { name: "considerationAmount", type: "uint256" },
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          { name: "offerToken", type: "address" },
          { name: "offerIdentifier", type: "uint256" },
          { name: "offerAmount", type: "uint256" },
          { name: "basicOrderType", type: "uint8" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "uint256" },
          { name: "salt", type: "uint256" },
          { name: "offererConduitKey", type: "uint256" },
          { name: "fulfillerConduitKey", type: "uint256" },
          { name: "totalOriginalAdditionalRecipients", type: "uint256" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "fulfilled", type: "bool" }],
  },
  {
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "orders",
        type: "tuple[]",
        components: [
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          { name: "zoneHash", type: "uint256" },
          { name: "salt", type: "uint256" },
          { name: "conduitKey", type: "uint256" },
          { name: "counter", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "cancelled", type: "bool" }],
  },
] as const;
