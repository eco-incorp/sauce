// Circle CCTP v2 — TokenMessengerV2. The burn side of Cross-Chain Transfer Protocol: `depositForBurn`
// burns USDC on the source chain and instructs Circle to mint it on the destination domain. This is
// the minimal surface a Sauce route needs to drive a CCTP transfer; the receive/mint side
// (MessageTransmitterV2.receiveMessage / gatewayMint) is attestation-driven and off-chain.
export const TokenMessengerABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;
