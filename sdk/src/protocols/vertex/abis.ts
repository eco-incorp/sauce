export const EndpointABI = [
  {
    name: "depositCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subaccountName", type: "uint256" },
      { name: "productId", type: "uint32" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    name: "submitSlowModeTransaction",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "transaction", type: "bytes" }],
    outputs: [],
  },
] as const;

export const ClearinghouseABI = [
  {
    name: "withdrawCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subaccountName", type: "uint256" },
      { name: "productId", type: "uint32" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
] as const;
