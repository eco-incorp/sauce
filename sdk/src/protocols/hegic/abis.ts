// Hegic's OperationalTreasury: options are exercised by paying off the position, and the payout
// goes to `account`. (The HEGIC token itself has no exercise entry point.)
export const HegicABI = [
  {
    name: "payOff",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "positionID", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [],
  },
] as const;
