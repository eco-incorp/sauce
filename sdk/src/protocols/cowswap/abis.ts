export const GPv2SettlementABI = [
  {
    name: "setPreSignature",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderUid", type: "bytes" },
      { name: "signed", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "invalidateOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderUid", type: "bytes" }],
    outputs: [],
  },
] as const;
