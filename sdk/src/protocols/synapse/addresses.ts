import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      synapseBridge: "0x2796317b0fF8538F253012862c06787Adfb8cEB6",
      cctpRouter: "0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      synapseBridge: "0x6F4e8eba4d337f874AB57478AcC2Cb5BacDc19c9",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      synapseBridge: "0xAf41a65F786339e7911F4acDAD6BD49426F2Dc6b",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      synapseBridge: "0xf07d1C752fAb503E47FEF309bf14fbDD3E867089",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      // A TransparentUpgradeableProxy to SynapseBridge; the address listed before had no code.
      synapseBridge: "0x8F5BBB2BB8c2Ee94639E55d5F41de9b4839C1280",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      synapseBridge: "0xC05e61d0E7a63D27546389B7aD62FdFf5A91aACE",
    },
  },
];
