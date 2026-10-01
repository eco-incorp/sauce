// CLFactory — fragments from its verified source (Sourcify, Arc 0xb89Df768…1d03, contracts/core/CLFactory.sol).
export const SlipstreamCLFactoryABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "tickSpacing", type: "int24" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "allPoolsLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tickSpacingToFee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "int24" }],
    outputs: [{ name: "", type: "uint24" }],
  },
] as const;

// CLPool — the reads a program makes on a pool it looked up through a CLFactory, from the verified
// CLPool source. Its `slot0` has no `feeProtocol`, unlike Uniswap V3's, and its `fee` is set per
// pool and can change, so a program reads it rather than assume the tick spacing's default.
export const AerodromeSlipstreamPoolABI = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    name: "liquidity",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
  {
    name: "fee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
  },
  {
    name: "tickSpacing",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
  },
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "token1",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// NonfungiblePositionManager — fragments from its verified source (Sourcify, Arc 0xc84bB45D…f473).
export const SlipstreamPositionManagerABI = [
  {
    name: "factory",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "positions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "tickSpacing", type: "int24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const;

// Metarouter — Aero's command-encoded router. Fragment from its verified source (Sourcify, Arc 0x7275FA44…c886, V3/src/metarouter/Metarouter.sol).
export const AeroMetarouterABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_commands", type: "bytes" },
      { name: "_inputs", type: "bytes[]" },
      { name: "_deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
