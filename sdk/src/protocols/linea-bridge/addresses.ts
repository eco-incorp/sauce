import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      l1MessageService: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
    },
  },
  {
    chainId: 59144,
    chainName: "Linea",
    addresses: {
      l2MessageService: "0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec",
    },
  },
];
