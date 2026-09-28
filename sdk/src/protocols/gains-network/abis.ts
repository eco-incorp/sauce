// gTrade's multi-collateral Diamond (GNSMultiCollatDiamond, v8+): trades are addressed by the
// trader's per-user `index`, not by (pairIndex, index), and prices/levels are packed integers.
export const DiamondABI = [
  {
    name: "openTrade",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "trade",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "index", type: "uint32" },
          { name: "pairIndex", type: "uint16" },
          { name: "leverage", type: "uint24" },
          { name: "long", type: "bool" },
          { name: "isOpen", type: "bool" },
          { name: "collateralIndex", type: "uint8" },
          { name: "tradeType", type: "uint8" },
          { name: "collateralAmount", type: "uint120" },
          { name: "openPrice", type: "uint64" },
          { name: "tp", type: "uint64" },
          { name: "sl", type: "uint64" },
          { name: "isCounterTrade", type: "bool" },
          { name: "positionSizeToken", type: "uint160" },
          { name: "__placeholder", type: "uint24" },
        ],
      },
      { name: "maxSlippageP", type: "uint16" },
      { name: "referrer", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "closeTradeMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "index", type: "uint32" },
      { name: "expectedPrice", type: "uint64" },
    ],
    outputs: [],
  },
  {
    name: "updateSl",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "index", type: "uint32" },
      { name: "newSl", type: "uint64" },
    ],
    outputs: [],
  },
  {
    name: "updateTp",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "index", type: "uint32" },
      { name: "newTp", type: "uint64" },
    ],
    outputs: [],
  },
] as const;
