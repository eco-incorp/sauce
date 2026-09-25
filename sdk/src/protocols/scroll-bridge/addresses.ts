import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      l1ScrollMessenger: "0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367",
      l1GatewayRouter: "0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6",
    },
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      l2ScrollMessenger: "0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC",
      l2GatewayRouter: "0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79",
    },
  },
];
