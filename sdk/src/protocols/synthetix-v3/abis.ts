export const CoreProxyABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accountId", type: "uint128" },
      { name: "collateralType", type: "address" },
      { name: "tokenAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accountId", type: "uint128" },
      { name: "collateralType", type: "address" },
      { name: "tokenAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "delegateCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accountId", type: "uint128" },
      { name: "poolId", type: "uint128" },
      { name: "collateralType", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "leverage", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const PerpsMarketProxyABI = [
  {
    name: "commitOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "commitment",
        type: "tuple",
        components: [
          { name: "marketId", type: "uint128" },
          { name: "accountId", type: "uint128" },
          { name: "sizeDelta", type: "uint128" },
          { name: "settlementStrategyId", type: "uint128" },
          { name: "acceptablePrice", type: "uint256" },
          { name: "trackingCode", type: "uint256" },
          { name: "referrer", type: "address" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "modifyCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accountId", type: "uint128" },
      { name: "synthMarketId", type: "uint128" },
      { name: "amountDelta", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
