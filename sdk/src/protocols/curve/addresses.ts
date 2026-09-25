import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      routerNG: "0x16C6521Dff6baB339122a0FE25a9116693265353",
      addressProvider: "0x0000000022D53366457F9d5E68Ec105046FC4383",
      crvToken: "0xD533a949740bb3306d119CC777fa900bA034cd52",
      threePool: "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      routerNG: "0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D",
      addressProvider: "0x0000000022D53366457F9d5E68Ec105046FC4383",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      routerNG: "0x0DCDED3545D565bA3B19E683431381007245d983",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      routerNG: "0x4f37A9d177470499A2dD084621020b023fcffc1F",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      addressProvider: "0x0000000022D53366457F9d5E68Ec105046FC4383",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      addressProvider: "0x0000000022D53366457F9d5E68Ec105046FC4383",
    },
  },
  {
    chainId: 250,
    chainName: "Fantom",
    addresses: {
      addressProvider: "0x0000000022D53366457F9d5E68Ec105046FC4383",
    },
  },
  {
    chainId: 100,
    chainName: "Gnosis",
    addresses: {
      addressProvider: "0x0000000022D53366457F9d5E68Ec105046FC4383",
    },
  },
];
