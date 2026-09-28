export const CurveRouterNGABI = [
  {
    name: "exchange",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_route", type: "address[11]" },
      { name: "_swap_params", type: "uint256[5][5]" },
      { name: "_amount", type: "uint256" },
      { name: "_expected", type: "uint256" },
      { name: "_pools", type: "address[5]" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "exchange",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_route", type: "address[11]" },
      { name: "_swap_params", type: "uint256[5][5]" },
      { name: "_amount", type: "uint256" },
      { name: "_min_dy", type: "uint256" },
      { name: "_pools", type: "address[5]" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "get_dy",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_route", type: "address[11]" },
      { name: "_swap_params", type: "uint256[5][5]" },
      { name: "_amount", type: "uint256" },
      { name: "_pools", type: "address[5]" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// The StableSwap-NG pool interface (plain and meta pools): int128 coin indices, dynamic-array
// liquidity amounts, and swaps that return the amount out. `exchange_underlying` exists on
// metapools only. Classic pools such as 3pool have their own shape: CurveThreePoolABI below.
export const CurveStableSwapABI = [
  {
    name: "exchange",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
      { name: "min_dy", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "exchange_underlying",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
      { name: "min_dy", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "add_liquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amounts", type: "uint256[]" },
      { name: "min_mint_amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "remove_liquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "min_amounts", type: "uint256[]" },
    ],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "remove_liquidity_one_coin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_token_amount", type: "uint256" },
      { name: "i", type: "int128" },
      { name: "min_amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "get_dy",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "get_virtual_price",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const CurveAddressProviderABI = [
  {
    name: "get_registry",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "get_address",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// 3pool (`threePool` in addresses.ts), a classic StableSwap pool: fixed-size uint256[3] liquidity
// arrays, and `exchange`/`remove_liquidity_one_coin`/`add_liquidity`/`remove_liquidity` return
// nothing. Read the amount out as a balance change.
export const CurveThreePoolABI = [
  {
    name: "exchange",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
      { name: "min_dy", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "add_liquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amounts", type: "uint256[3]" },
      { name: "min_mint_amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "remove_liquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "min_amounts", type: "uint256[3]" },
    ],
    outputs: [],
  },
  {
    name: "remove_liquidity_one_coin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_token_amount", type: "uint256" },
      { name: "i", type: "int128" },
      { name: "min_amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "get_dy",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "get_virtual_price",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
