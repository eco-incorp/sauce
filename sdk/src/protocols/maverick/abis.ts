export const MaverickV2RouterABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "pool", type: "address" },
      { name: "tokenAIn", type: "bool" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    name: "exactOutputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "pool", type: "address" },
      { name: "tokenAIn", type: "bool" },
      { name: "amountOut", type: "uint256" },
      { name: "amountInMaximum", type: "uint256" },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
    ],
  },
] as const;

export const MaverickV2FactoryABI = [
  {
    name: "lookup",
    type: "function",
    stateMutability: "view",
    // Paged: pools [startIndex, endIndex) for the pair. There is no two-argument overload.
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "startIndex", type: "uint256" },
      { name: "endIndex", type: "uint256" },
    ],
    outputs: [{ name: "pools", type: "address[]" }],
  },
] as const;

// MaverickV2Pool — the reads a program makes on a pool it looked up through V2Factory: its state
// (reserves, active tick, TWAP), its fee per direction (18 decimals: 1e16 is 1%), its tick spacing,
// and its tokens (token A is the lower address). Its `swap` calls back for the input, which a
// program cannot answer, so it is not declared. Fragments from IMaverickV2Pool
// (maverickprotocol/v2-common); the pools have no verified source.
export const MaverickV2PoolABI = [
  {
    name: "getState",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "reserveA", type: "uint128" },
          { name: "reserveB", type: "uint128" },
          { name: "lastTwaD8", type: "int64" },
          { name: "lastLogPriceD8", type: "int64" },
          { name: "lastTimestamp", type: "uint40" },
          { name: "activeTick", type: "int32" },
          { name: "isLocked", type: "bool" },
          { name: "binCounter", type: "uint32" },
          { name: "protocolFeeRatioD3", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "fee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenAIn", type: "bool" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tickSpacing",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tokenA",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenB",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
