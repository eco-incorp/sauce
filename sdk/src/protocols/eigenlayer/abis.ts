export const StrategyManagerABI = [
  {
    name: "depositIntoStrategy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "strategy", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "stakerStrategyShares",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "staker", type: "address" },
      { name: "strategy", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const DelegationManagerABI = [
  {
    name: "delegateTo",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      {
        name: "approverSignatureAndExpiry",
        type: "tuple",
        components: [
          { name: "signature", type: "bytes" },
          { name: "expiry", type: "uint256" },
        ],
      },
      { name: "approverSalt", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "undelegate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "staker", type: "address" }],
    outputs: [{ name: "withdrawalRoots", type: "uint256[]" }],
  },
  {
    name: "isDelegated",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "staker", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const StrategyABI = [
  {
    name: "sharesToUnderlyingView",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "amountShares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "underlyingToSharesView",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "amountUnderlying", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
