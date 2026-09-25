export const ThalesAMMABI = [
  {
    name: "buyFromAMM",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "position", type: "uint8" },
      { name: "amount", type: "uint256" },
      { name: "expectedPayout", type: "uint256" },
      { name: "additionalSlippage", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "exerciseMaturedMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "market", type: "address" }],
    outputs: [],
  },
] as const;

export const SpeedMarketsAMMABI = [
  {
    name: "createNewMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "uint256" },
      { name: "strikeTime", type: "uint64" },
      { name: "direction", type: "uint8" },
      { name: "collateral", type: "address" },
      { name: "buyinAmount", type: "uint256" },
      { name: "referrer", type: "address" },
    ],
    outputs: [],
  },
] as const;
