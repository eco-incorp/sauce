export const EndpointABI = [
  {
    name: "depositCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subaccountName", type: "bytes12" },
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

// The Clearinghouse applies a sequenced WithdrawCollateral transaction (sender subaccount, product,
// amount, nonce); users submit withdrawals through the Endpoint (`submitSlowModeTransaction`).
export const ClearinghouseABI = [
  {
    name: "withdrawCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "txn",
        type: "tuple",
        components: [
          { name: "sender", type: "bytes32" },
          { name: "productId", type: "uint32" },
          { name: "amount", type: "uint128" },
          { name: "nonce", type: "uint64" },
        ],
      },
    ],
    outputs: [],
  },
] as const;
