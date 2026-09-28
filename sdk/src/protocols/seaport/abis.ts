// Seaport 1.6. Order components are the full on-chain structs: offer/consideration items, zone
// hashes and conduit keys as bytes32, and fulfillBasicOrder's additional recipients.
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
          { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "offererConduitKey", type: "bytes32" },
          { name: "fulfillerConduitKey", type: "bytes32" },
          { name: "totalOriginalAdditionalRecipients", type: "uint256" },
          {
            name: "additionalRecipients",
            type: "tuple[]",
            components: [
              { name: "amount", type: "uint256" },
              { name: "recipient", type: "address" },
            ],
          },
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
          {
            name: "offer",
            type: "tuple[]",
            components: [
              { name: "itemType", type: "uint8" },
              { name: "token", type: "address" },
              { name: "identifierOrCriteria", type: "uint256" },
              { name: "startAmount", type: "uint256" },
              { name: "endAmount", type: "uint256" },
            ],
          },
          {
            name: "consideration",
            type: "tuple[]",
            components: [
              { name: "itemType", type: "uint8" },
              { name: "token", type: "address" },
              { name: "identifierOrCriteria", type: "uint256" },
              { name: "startAmount", type: "uint256" },
              { name: "endAmount", type: "uint256" },
              { name: "recipient", type: "address" },
            ],
          },
          { name: "orderType", type: "uint8" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "conduitKey", type: "bytes32" },
          { name: "counter", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "cancelled", type: "bool" }],
  },
] as const;
