import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      mETH: "0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa",
      // Staking: stake() and the mETH/ETH rate live here, not on the token (Staking.mETH() is
      // the token above).
      staking: "0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f",
    },
  },
];
