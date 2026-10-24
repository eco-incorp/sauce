import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      l1EthBridge: "0xb8901acB165ed027E32754E0FFe830802919727f",
      l1UsdcBridge: "0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      // WETH wrapper (l2CanonicalToken() is WETH); the address listed before had no code.
      l2AmmWrapper: "0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      l2AmmWrapper: "0x86cA30bEF97fB651b8d866D45503684b90cb3312",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      // The USDC wrapper (l2CanonicalToken() is USDC.e), unlike the WETH wrappers listed elsewhere.
      l2AmmWrapper: "0x76b22b8C1079A44F1211D867D68b1eda76a635A7",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      // WETH wrapper (l2CanonicalToken() is WETH); the address listed before had no code.
      l2AmmWrapper: "0x10541b07d8Ad2647Dc6cD67abd4c03575dade261",
    },
  },
];
