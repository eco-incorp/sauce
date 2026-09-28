// MUX v1. Liquidity is added and removed through OrderBook orders that brokers fill; the
// LiquidityPool's own add/remove functions are OrderBook-only. Its user surface is collateral and reads.
export const LiquidityPoolABI = [
  {
    name: "depositCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subAccountId", type: "bytes32" },
      { name: "rawAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getAssetAddress",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint8" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getSubAccount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "subAccountId", type: "bytes32" }],
    outputs: [
      { name: "collateral", type: "uint96" },
      { name: "size", type: "uint96" },
      { name: "lastIncreasedTime", type: "uint32" },
      { name: "entryPrice", type: "uint96" },
      { name: "entryFunding", type: "uint128" },
    ],
  },
] as const;

export const OrderBookABI = [
  {
    name: "cancelOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "uint64" }],
    outputs: [],
  },
  {
    name: "placeLiquidityOrder",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "assetId", type: "uint8" },
      { name: "rawAmount", type: "uint96" },
      { name: "isAdding", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "placePositionOrder3",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "subAccountId", type: "bytes32" },
      { name: "collateralAmount", type: "uint96" },
      { name: "size", type: "uint96" },
      { name: "price", type: "uint96" },
      { name: "profitTokenId", type: "uint8" },
      { name: "flags", type: "uint8" },
      { name: "deadline", type: "uint32" },
      { name: "referralCode", type: "bytes32" },
      {
        name: "extra",
        type: "tuple",
        components: [
          { name: "tpPrice", type: "uint96" },
          { name: "slPrice", type: "uint96" },
          { name: "tpslProfitTokenId", type: "uint8" },
          { name: "tpslDeadline", type: "uint32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;
