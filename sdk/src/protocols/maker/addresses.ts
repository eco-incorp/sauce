import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      dai: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      usds: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
      sDAI: "0x83F20F44975D03b1b09e64809B757c47f942BEeA",
      vat: "0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B",
      pot: "0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7",
    },
  },
];
