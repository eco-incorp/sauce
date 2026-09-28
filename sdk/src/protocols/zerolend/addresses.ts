import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 324,
    chainName: "zkSync",
    addresses: {
      // zToken.POOL(); the address listed before differed in one digit and had no code.
      pool: "0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8",
    },
  },
];
