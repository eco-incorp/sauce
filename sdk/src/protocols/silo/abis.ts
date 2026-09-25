export const SiloABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "collateralOnly", type: "bool" },
    ],
    outputs: [
      { name: "collateralAmount", type: "uint256" },
      { name: "collateralShare", type: "uint256" },
    ],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "collateralOnly", type: "bool" },
    ],
    outputs: [{ name: "withdrawnAmount", type: "uint256" }],
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "debtAmount", type: "uint256" },
      { name: "debtShare", type: "uint256" },
    ],
  },
  {
    name: "repay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "repaidAmount", type: "uint256" },
      { name: "repaidShare", type: "uint256" },
    ],
  },
] as const;

export const SiloRepositoryABI = [
  {
    name: "getSilo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "silo", type: "address" }],
  },
] as const;
