export const VaultABI = [
  {
    name: "swap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_tokenIn", type: "address" },
      { name: "_tokenOut", type: "address" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "increasePosition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_account", type: "address" },
      { name: "_collateralToken", type: "address" },
      { name: "_indexToken", type: "address" },
      { name: "_sizeDelta", type: "uint256" },
      { name: "_isLong", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "decreasePosition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_account", type: "address" },
      { name: "_collateralToken", type: "address" },
      { name: "_indexToken", type: "address" },
      { name: "_collateralDelta", type: "uint256" },
      { name: "_sizeDelta", type: "uint256" },
      { name: "_isLong", type: "bool" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const PositionRouterABI = [
  {
    name: "createIncreasePosition",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_path", type: "address[]" },
      { name: "_indexToken", type: "address" },
      { name: "_amountIn", type: "uint256" },
      { name: "_minOut", type: "uint256" },
      { name: "_sizeDelta", type: "uint256" },
      { name: "_isLong", type: "bool" },
      { name: "_acceptablePrice", type: "uint256" },
      { name: "_executionFee", type: "uint256" },
      { name: "_referralCode", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "createDecreasePosition",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_path", type: "address[]" },
      { name: "_indexToken", type: "address" },
      { name: "_collateralDelta", type: "uint256" },
      { name: "_sizeDelta", type: "uint256" },
      { name: "_isLong", type: "bool" },
      { name: "_receiver", type: "address" },
      { name: "_acceptablePrice", type: "uint256" },
      { name: "_minOut", type: "uint256" },
      { name: "_executionFee", type: "uint256" },
      { name: "_withdrawETH", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export const RouterABI = [
  {
    name: "approvePlugin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_plugin", type: "address" }],
    outputs: [],
  },
  {
    name: "swap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_path", type: "address[]" },
      { name: "_amountIn", type: "uint256" },
      { name: "_minOut", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [],
  },
] as const;
