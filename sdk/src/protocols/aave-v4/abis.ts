// Spoke — the user-facing Aave V4 market. Fragments from the verified SpokeInstance (Ethereum 0x7a603b73…7450).
export const AaveV4SpokeABI = [
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
  },
  {
    name: "repay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
  },
  {
    name: "setUsingAsCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "usingAsCollateral", type: "bool" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "getReserveId",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "hub", type: "address" },
      { name: "assetId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getReserveCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getUserSuppliedAssets",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getUserTotalDebt",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Hub — the shared Aave V4 liquidity hub Spokes draw from. Fragments from the verified HubInstance (Ethereum 0xfe89fd96…f704).
export const AaveV4HubABI = [
  {
    name: "getAssetId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "underlying", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getAssetCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getAssetLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "isUnderlyingListed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "underlying", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
