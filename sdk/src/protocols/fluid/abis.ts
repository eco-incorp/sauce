// Fluid has no deposit/borrow entry point on the Liquidity layer (`liquidity` in addresses.ts):
// its only user-level function, `operate`, is restricted to Fluid's own protocols. Users lend
// through fTokens (ERC-4626 vaults over the Liquidity layer) and borrow through Vaults.

/** An fToken, e.g. fUSDC: ERC-4626 lending over the Liquidity layer. */
export const FluidLendingABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    name: "asset",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * A Fluid Vault (e.g. VaultT1): one `operate` call moves collateral and debt of a position NFT.
 * Positive deltas deposit/borrow, negative ones withdraw/repay; `nftId` 0 opens a new position.
 */
export const FluidVaultABI = [
  {
    name: "operate",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "nftId", type: "uint256" },
      { name: "newCol", type: "int256" },
      { name: "newDebt", type: "int256" },
      { name: "to", type: "address" },
    ],
    outputs: [
      { name: "", type: "uint256" },
      { name: "", type: "int256" },
      { name: "", type: "int256" },
    ],
  },
] as const;
