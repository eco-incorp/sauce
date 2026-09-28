export const OpenOceanExchangeV2ABI = [
  {
    name: "swap",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "caller", type: "address" },
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
          { name: "guaranteedAmount", type: "uint256" },
          { name: "flags", type: "uint256" },
          { name: "referrer", type: "address" },
          { name: "permit", type: "bytes" },
        ],
      },
      {
        // The executor's call list, built by the OpenOcean API.
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "uint256" },
          { name: "gasLimit", type: "uint256" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "returnAmount", type: "uint256" }],
  },
] as const;
