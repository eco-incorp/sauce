export const PythOracleABI = [
  {
    name: "updatePriceFeeds",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
  {
    // The feed id is a bytes32, and PythStructs.Price is signed where a price can be: `price` is an
    // int64 and `expo` an int32 (usually negative, e.g. -8). The deployed implementation has no
    // verified source; these are the Pyth SDK's IPyth/PythStructs types.
    name: "getPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
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
