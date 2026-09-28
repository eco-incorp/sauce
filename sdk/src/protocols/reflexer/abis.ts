export const SAFEEngineABI = [
  {
    name: "modifySAFECollateralization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralType", type: "bytes32" },
      { name: "safe", type: "address" },
      { name: "collateralSource", type: "address" },
      { name: "debtDestination", type: "address" },
      { name: "deltaCollateral", type: "int256" },
      { name: "deltaDebt", type: "int256" },
    ],
    outputs: [],
  },
  {
    name: "safes",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "collateralType", type: "bytes32" },
      { name: "safe", type: "address" },
    ],
    outputs: [
      { name: "lockedCollateral", type: "uint256" },
      { name: "generatedDebt", type: "uint256" },
    ],
  },
] as const;

export const CoinJoinABI = [
  {
    name: "join",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "wad", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "exit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "wad", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// The `ethJoin` deployment is a CollateralJoin for WETH: it joins WETH tokens, not native ETH.
export const ETHJoinABI = [
  {
    name: "join",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "wad", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "exit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "wad", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
