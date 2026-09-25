import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      strategyManager: "0x858646372CC42E1A627fcE94aa7A7033e7CF075A",
      delegationManager: "0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A",
      stETHStrategy: "0x93c4b944D05dfe6df7645A86cd2206016c51564D",
      rETHStrategy: "0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2",
      cbETHStrategy: "0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc",
    },
  },
];
