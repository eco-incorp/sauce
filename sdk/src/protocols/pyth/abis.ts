export const PythOracleABI = [
  {
    name: "updatePriceFeeds",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
  {
    name: "getPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "uint64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "uint32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getUpdateFee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
] as const;
