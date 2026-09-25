import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      hubPool: "0xc186fA914353c44b2E33eBE05f21846F1048bEda",
      spokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      spokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      spokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      spokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      spokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
    },
  },
  {
    chainId: 324,
    chainName: "zkSync",
    addresses: {
      spokePool: "0xE0B015E54d54fc84a6cB9B666099c46adE9335FF",
    },
  },
  {
    chainId: 59144,
    chainName: "Linea",
    addresses: {
      spokePool: "0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75",
    },
  },
  {
    chainId: 34443,
    chainName: "Mode",
    addresses: {
      spokePool: "0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96",
    },
  },
  {
    chainId: 81457,
    chainName: "Blast",
    addresses: {
      spokePool: "0x2D509190Ed0172ba588407D4c2df918F955Cc6E1",
    },
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      spokePool: "0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96",
    },
  },
];
