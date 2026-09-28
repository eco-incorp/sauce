export const AggregationRouterV6ABI = [
  {
    name: "swap",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "executor", type: "address" },
      {
        name: "desc",
        type: "tuple",
        components: [
          { name: "srcToken", type: "address" },
          { name: "dstToken", type: "address" },
          { name: "srcReceiver", type: "address" },
          { name: "dstReceiver", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "minReturnAmount", type: "uint256" },
          { name: "flags", type: "uint256" },
        ],
      },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "returnAmount", type: "uint256" },
      { name: "spentAmount", type: "uint256" },
    ],
  },
  {
    // V6 packs each address with flags into a uint256 (`Address` in 1inch's source): `token` is
    // the source token, `dex` the pool plus its protocol/direction bits. The V5 array form is gone.
    name: "unoswap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "minReturn", type: "uint256" },
      { name: "dex", type: "uint256" },
    ],
    outputs: [{ name: "returnAmount", type: "uint256" }],
  },
] as const;
