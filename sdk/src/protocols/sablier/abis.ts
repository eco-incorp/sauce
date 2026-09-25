export const LockupLinearABI = [
  {
    name: "createWithDurations",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "recipient", type: "address" },
          { name: "totalAmount", type: "uint128" },
          { name: "asset", type: "address" },
          { name: "cancelable", type: "bool" },
          { name: "transferable", type: "bool" },
          {
            name: "durations",
            type: "tuple",
            components: [
              { name: "cliff", type: "uint64" },
              { name: "total", type: "uint64" },
            ],
          },
          {
            name: "broker",
            type: "tuple",
            components: [
              { name: "account", type: "address" },
              { name: "fee", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "streamId", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "streamId", type: "uint256" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "streamId", type: "uint256" }],
    outputs: [],
  },
] as const;
