import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      cUSDCv3: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
      cWETHv3: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
      cUSDTv3: "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      cUSDCv3: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
      cUSDTv3: "0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      cUSDCv3: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
      cWETHv3: "0x46e6b214b524310239732D51387075E0e70970bf",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      cUSDCv3: "0xF25212E676D1F7F89Cd72fFEe66158f541246445",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      cUSDCv3: "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB",
    },
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      cUSDCv3: "0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44",
    },
  },
];
