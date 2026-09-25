export const KyberSwapMetaAggregationRouterABI = [
  {
    name: "swap",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "execution",
        type: "tuple",
        components: [
          { name: "callTarget", type: "address" },
          { name: "approveTarget", type: "address" },
          { name: "targetData", type: "bytes" },
          {
            name: "desc",
            type: "tuple",
            components: [
              { name: "srcToken", type: "address" },
              { name: "dstToken", type: "address" },
              { name: "srcReceivers", type: "address[]" },
              { name: "srcAmounts", type: "uint256[]" },
              { name: "feeReceivers", type: "address[]" },
              { name: "feeAmounts", type: "uint256[]" },
              { name: "dstReceiver", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "minReturnAmount", type: "uint256" },
              { name: "flags", type: "uint256" },
              { name: "permit", type: "bytes" },
            ],
          },
          { name: "clientData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "returnAmount", type: "uint256" },
      { name: "gasUsed", type: "uint256" },
    ],
  },
] as const;
