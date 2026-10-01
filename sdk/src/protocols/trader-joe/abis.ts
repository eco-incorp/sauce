export const LBRouterABI = [
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      {
        name: "path",
        type: "tuple",
        components: [
          { name: "pairBinSteps", type: "uint256[]" },
          { name: "versions", type: "uint8[]" },
          { name: "tokenPath", type: "address[]" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    name: "swapTokensForExactTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "amountInMax", type: "uint256" },
      {
        name: "path",
        type: "tuple",
        components: [
          { name: "pairBinSteps", type: "uint256[]" },
          { name: "versions", type: "uint8[]" },
          { name: "tokenPath", type: "address[]" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountsIn", type: "uint256[]" }],
  },
  {
    name: "addLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "liquidityParameters",
        type: "tuple",
        components: [
          { name: "tokenX", type: "address" },
          { name: "tokenY", type: "address" },
          { name: "binStep", type: "uint256" },
          { name: "amountX", type: "uint256" },
          { name: "amountY", type: "uint256" },
          { name: "amountXMin", type: "uint256" },
          { name: "amountYMin", type: "uint256" },
          { name: "activeIdDesired", type: "uint256" },
          { name: "idSlippage", type: "uint256" },
          { name: "deltaIds", type: "int256[]" },
          { name: "distributionX", type: "uint256[]" },
          { name: "distributionY", type: "uint256[]" },
          { name: "to", type: "address" },
          { name: "refundTo", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "amountXAdded", type: "uint256" },
      { name: "amountYAdded", type: "uint256" },
      { name: "amountXLeft", type: "uint256" },
      { name: "amountYLeft", type: "uint256" },
      { name: "depositIds", type: "uint256[]" },
      { name: "liquidityMinted", type: "uint256[]" },
    ],
  },
] as const;

export const LBFactoryABI = [
  {
    name: "getLBPairInformation",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "binStep", type: "uint256" },
    ],
    outputs: [
      {
        name: "lbPairInformation",
        type: "tuple",
        components: [
          { name: "binStep", type: "uint16" },
          { name: "LBPair", type: "address" },
          { name: "createdByOwner", type: "bool" },
          { name: "ignoredForRouting", type: "bool" },
        ],
      },
    ],
  },
] as const;

// LBPair — the reads a program makes on a pair it looked up through LBFactory, and `swap`, called
// directly once the input is transferred to the pair: `swapForY` sells X for Y. `getSwapOut` quotes
// a sale: a nonzero `amountInLeft` is more than the pair's liquidity can fill, and a `swap` of it
// reverts. `swap` returns both amounts in one word, X in the low 128 bits and Y in the high 128;
// `getPriceFromId` is a bin's price of X in Y, 128.128 fixed point. From the verified LBPair source
// (v2.2, whose reads and swap are v2.1's); every pair is a clone of it.
export const LBPairABI = [
  {
    name: "getTokenX",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "tokenX", type: "address" }],
  },
  {
    name: "getTokenY",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "tokenY", type: "address" }],
  },
  {
    name: "getBinStep",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    name: "getActiveId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "activeId", type: "uint24" }],
  },
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserveX", type: "uint128" },
      { name: "reserveY", type: "uint128" },
    ],
  },
  {
    name: "getBin",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint24" }],
    outputs: [
      { name: "binReserveX", type: "uint128" },
      { name: "binReserveY", type: "uint128" },
    ],
  },
  {
    name: "getPriceFromId",
    type: "function",
    stateMutability: "pure",
    inputs: [{ name: "id", type: "uint24" }],
    outputs: [{ name: "price", type: "uint256" }],
  },
  {
    name: "getSwapIn",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountOut", type: "uint128" },
      { name: "swapForY", type: "bool" },
    ],
    outputs: [
      { name: "amountIn", type: "uint128" },
      { name: "amountOutLeft", type: "uint128" },
      { name: "fee", type: "uint128" },
    ],
  },
  {
    name: "getSwapOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint128" },
      { name: "swapForY", type: "bool" },
    ],
    outputs: [
      { name: "amountInLeft", type: "uint128" },
      { name: "amountOut", type: "uint128" },
      { name: "fee", type: "uint128" },
    ],
  },
  {
    name: "swap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "swapForY", type: "bool" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "amountsOut", type: "bytes32" }],
  },
] as const;
